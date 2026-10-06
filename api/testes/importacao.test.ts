/** Importação dos usuários do Cronogramas (etapa 5). */
import { beforeEach, describe, expect, it } from "vitest";
import { gerarHashSenha } from "plataforma-kit/seguranca";
import { converterPermissoes } from "../src/importacao.ts";
import { entrar, montarPortal } from "./apoio.ts";

const ID = {
  cliente: "6eb23d0e-dcb7-4478-bb1c-326a3b352cec",
  projetos: "11111111-1111-4111-8111-111111111111",
  comercial: "22222222-2222-4222-8222-222222222222",
  cliente_perfil: "33333333-3333-4333-8333-333333333333",
  ana: "c882e72d-e5d2-478a-88de-8eb13c168b3a",
  bruno: "a7911efc-c865-41a3-aab9-d9985ef8bbb0",
  carla: "da721a6a-73ef-4e9d-9bf3-3a4bfdff142d",
};

async function exportacao() {
  const senha = await gerarHashSenha("Senha-do-Cronogramas-1");
  return {
    origem: "cronogramas",
    versao: "schema cronogramas",
    clientes: [{ id: ID.cliente, nome: "Lume", documento: "12.345.678/0001-90", ativo: true }],
    perfis: [
      {
        id: ID.projetos,
        nome: "Projetos",
        descricao: "Implantação",
        permissoes: ["cronogramas.criar", "visao.interna"],
      },
      { id: ID.comercial, nome: "Comercial (teste)", descricao: null, permissoes: ["modelos.ver"] },
      { id: ID.cliente_perfil, nome: "Cliente", descricao: null, permissoes: [] },
    ],
    usuarios: [
      {
        id: ID.ana,
        nome: "Ana",
        email: "ana@x.com",
        tipo: "interno",
        cliente_id: null,
        ativo: true,
        administrador: true,
        perfil_id: null,
        senha_hash: senha,
        precisa_trocar_senha: false,
      },
      {
        id: ID.bruno,
        nome: "Bruno",
        email: "bruno@x.com",
        tipo: "interno",
        cliente_id: null,
        ativo: true,
        administrador: false,
        perfil_id: ID.comercial,
        senha_hash: senha,
        precisa_trocar_senha: false,
      },
      {
        id: ID.carla,
        nome: "Carla",
        email: "Carla@Lume.com",
        tipo: "externo",
        cliente_id: ID.cliente,
        ativo: true,
        administrador: false,
        perfil_id: ID.cliente_perfil,
        senha_hash: null,
        precisa_trocar_senha: true,
      },
    ],
  };
}

let p: Awaited<ReturnType<typeof montarPortal>>;
let admin: string;
const importar = (dados: unknown, simular: boolean, reconciliarPorEmail = true, cookie = admin) =>
  p.app.inject({
    method: "POST",
    url: "/api/portal/importacao/cronogramas",
    headers: { cookie },
    payload: { dados, simular, reconciliarPorEmail },
  });

beforeEach(async () => {
  p = await montarPortal();
  admin = await entrar(p.app, "admin@portal.teste");
});

describe("conversão dos perfis", () => {
  it("prefixo do kit, portal.interno pela visão interna ou por usuário interno, cronogramas.ver se existir", () => {
    expect(converterPermissoes(["modelos.ver", "visao.interna"], false, [])).toEqual([
      "cronogramas.modelos.ver",
      "cronogramas.visao.interna",
      "portal.interno",
    ]);
    expect(converterPermissoes(["cronogramas.criar"], true, [])).toEqual(["cronogramas.criar", "portal.interno"]);
    // perfil de cliente nasce sem nenhum módulo, mesmo com cronogramas.ver no catálogo (decisão de 06/10/2026)
    expect(converterPermissoes([], false, ["cronogramas.ver"])).toEqual([]);
    expect(converterPermissoes(["visao.interna"], false, ["cronogramas.ver"])).toContain("cronogramas.ver");
  });
});

describe("importação", () => {
  it("a prévia é o resultado exato e não grava nada", async () => {
    const antes = (await p.banco.query("SELECT count(*)::int AS n FROM usuarios")).rows[0].n;
    const r = (await importar(await exportacao(), true)).json();
    expect(r).toMatchObject({ simulacao: true, clientes: { criados: 1 }, usuarios: { criados: 3 } });
    expect((await p.banco.query("SELECT count(*)::int AS n FROM usuarios")).rows[0].n).toBe(antes);
    expect((await p.banco.query("SELECT count(*)::int AS n FROM importacoes")).rows[0].n).toBe(0);
  });

  it("mantém ids, converte perfis, renomeia nome repetido e leva a senha do Cronogramas", async () => {
    const r = (await importar(await exportacao(), false)).json();
    expect(r.perfis.renomeados).toEqual([{ de: "Comercial (teste)", para: "Comercial (teste) (Cronogramas)" }]);
    expect(r.usuarios).toMatchObject({ criados: 3, comSenhaDoCronogramas: 2, semSenha: ["carla@lume.com"] });
    expect(
      r.avisos.some((a: string) => a.includes("Perfis de cliente entram sem acesso") && a.includes("Cliente")),
    ).toBe(true);
    const cliente = (await p.banco.query("SELECT permissoes FROM perfis WHERE id = $1", [ID.cliente_perfil])).rows[0];
    expect(cliente.permissoes).toEqual([]);
    // a cliente importada entra no portal sem nenhum módulo
    await p.banco.query(
      "UPDATE usuarios SET senha_hash = (SELECT senha_hash FROM usuarios WHERE id = $1), precisa_trocar_senha = false WHERE id = $2",
      [ID.ana, ID.carla],
    );
    const carla = await entrar(p.app, "carla@lume.com", "Senha-do-Cronogramas-1");
    expect((await p.app.inject({ url: "/api/portal/menu", headers: { cookie: carla } })).json()).toEqual([]);
    const u = (
      await p.banco.query(
        "SELECT id, tipo, cliente_id, administrador, perfil_id FROM usuarios WHERE email = 'carla@lume.com'",
      )
    ).rows[0];
    expect(u).toEqual({
      id: ID.carla,
      tipo: "externo",
      cliente_id: ID.cliente,
      administrador: false,
      perfil_id: ID.cliente_perfil,
    });
    const perfil = (await p.banco.query("SELECT permissoes FROM perfis WHERE id = $1", [ID.projetos])).rows[0];
    expect(perfil.permissoes.sort()).toEqual(["cronogramas.criar", "cronogramas.visao.interna", "portal.interno"]);
    const cookie = await entrar(p.app, "ana@x.com", "Senha-do-Cronogramas-1");
    const eu = (await p.app.inject({ url: "/api/eu", headers: { cookie } })).json();
    expect(eu).toMatchObject({ id: ID.ana, administrador: true });
    expect((await p.banco.query("SELECT count(*)::int AS n FROM importacoes")).rows[0].n).toBe(1);
  });

  it("reimportar não duplica, não desfaz senha trocada no portal e mantém permissões de outros módulos", async () => {
    await importar(await exportacao(), false);
    await p.banco.query("UPDATE usuarios SET senha_hash = $2 WHERE id = $1", [
      ID.bruno,
      await gerarHashSenha("Nova-no-Portal-9"),
    ]);
    await p.banco.query("UPDATE perfis SET permissoes = permissoes || '{orcamentos.ver}' WHERE id = $1", [ID.projetos]);
    const r = (await importar(await exportacao(), false)).json();
    expect(r.usuarios).toMatchObject({ criados: 0, atualizados: 3, comSenhaDoCronogramas: 0 });
    expect(r.perfis.criados).toEqual([]);
    await entrar(p.app, "bruno@x.com", "Nova-no-Portal-9");
    const perfil = (await p.banco.query("SELECT permissoes FROM perfis WHERE id = $1", [ID.projetos])).rows[0];
    expect(perfil.permissoes).toContain("orcamentos.ver");
    expect((await p.banco.query("SELECT count(*)::int AS n FROM usuarios")).rows[0].n).toBe(7);
  });

  it("reconcilia por e-mail: o usuário do portal passa a ter o id do Cronogramas, com a sessão aberta", async () => {
    // o administrador que importa tem, no Cronogramas, outro id
    const dados = await exportacao();
    dados.usuarios[0].email = "admin@portal.teste";
    const idAntes = (await p.app.inject({ url: "/api/eu", headers: { cookie: admin } })).json().id;
    const r = (await importar(dados, false)).json();
    expect(r.usuarios.reconciliados).toEqual([{ email: "admin@portal.teste", idAnterior: idAntes, idNovo: ID.ana }]);
    const eu = (await p.app.inject({ url: "/api/eu", headers: { cookie: admin } })).json();
    expect(eu).toMatchObject({ id: ID.ana, administrador: true });
    // a senha do portal fica (ele já tinha uma)
    await entrar(p.app, "admin@portal.teste");
    const hist = (await p.app.inject({ url: "/api/portal/importacoes", headers: { cookie: admin } })).json();
    expect(hist[0].feita_por).toBe("Ana");
  });

  it("sem reconciliar, e-mail já existente com outro id fica de fora", async () => {
    const dados = await exportacao();
    dados.usuarios[1].email = "projetos@portal.teste";
    const r = (await importar(dados, false, false)).json();
    expect(r.usuarios.conflitos).toEqual([
      { email: "projetos@portal.teste", motivo: expect.stringMatching(/reconciliar/) },
    ]);
    expect(r.usuarios.criados).toBe(2);
  });

  it("arquivo inválido: 400 com o motivo", async () => {
    const r = await importar({ origem: "orcamentos", usuarios: [] }, true);
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toMatch(/não é uma exportação do Cronogramas/);
    const r2 = await importar({ origem: "cronogramas", usuarios: [{ id: "x" }] }, true);
    expect(r2.statusCode).toBe(400);
    expect(r2.json().erro).toMatch(/usuarios\.0/);
  });

  it("administrador externo e cliente ausente viram avisos", async () => {
    const dados = await exportacao();
    dados.clientes = [];
    dados.usuarios[2].administrador = true;
    const r = (await importar(dados, true)).json();
    expect(r.avisos.join(" ")).toMatch(/administrador externo/);
    expect(r.avisos.join(" ")).toMatch(/não veio na exportação/);
  });
});
