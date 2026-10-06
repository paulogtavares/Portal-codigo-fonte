/** Administração (etapa 5) e saúde (etapa 6): perfis com visões por módulo, usuários externos, tela de módulos. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entrar, montarPortal, subirModulo, type ModuloTeste } from "./apoio.ts";

let cron: ModuloTeste;
let portal: Awaited<ReturnType<typeof montarPortal>>;
let admin: string;

beforeAll(async () => {
  cron = await subirModulo({ id: "cronogramas" });
  portal = await montarPortal({ modulos: [cron], env: { MODULOS: `cronogramas=${cron.url},cp=http://127.0.0.1:1` } });
  admin = await entrar(portal.app, "admin@portal.teste");
});
afterAll(async () => {
  await portal.app.close();
  await cron.fechar();
});

const req = (method: any, url: string, cookie: string, payload?: unknown) =>
  portal.app.inject({ method, url, headers: { cookie }, payload: payload as any });

describe("perfis com visões por módulo", () => {
  it("catálogo agregado: as do portal e as de cada módulo, com o módulo de origem", async () => {
    const r = (await req("GET", "/api/admin/permissoes", admin)).json();
    expect(r.filter((x: any) => x.modulo === "portal").map((x: any) => x.chave)).toEqual([
      "portal.interno",
      "portal.modulos.ver",
    ]);
    expect(r.find((x: any) => x.chave === "cronogramas.editar")).toMatchObject({
      modulo: "cronogramas",
      moduloNome: "Módulo cronogramas",
    });
  });

  it("perfil criado com permissões de módulo controla o menu e o token", async () => {
    const perfil = (
      await req("POST", "/api/admin/perfis", admin, {
        nome: "Leitura Cronogramas",
        permissoes: ["portal.interno", "cronogramas.ver"],
      })
    ).json();
    const u = (
      await req("POST", "/api/admin/usuarios", admin, { nome: "Lia", email: "lia@x.com", perfil_id: perfil.id })
    ).json();
    expect(u.senha_provisoria).toBeTruthy();
    const desconhecida = await req("POST", "/api/admin/perfis", admin, { nome: "X", permissoes: ["cp.inexistente"] });
    expect(desconhecida.statusCode).toBe(400);
  });

  it("usuário externo: perfil sem portal.interno e cliente de referência", async () => {
    await portal.banco.query("INSERT INTO clientes (id, nome) VALUES ('6eb23d0e-dcb7-4478-bb1c-326a3b352cec', 'Lume')");
    const perfil = (
      await req("POST", "/api/admin/perfis", admin, { nome: "Cliente", permissoes: ["cronogramas.ver"] })
    ).json();
    const r = await req("POST", "/api/admin/usuarios", admin, {
      nome: "Carla",
      email: "carla@lume.com",
      perfil_id: perfil.id,
      cliente_id: "6eb23d0e-dcb7-4478-bb1c-326a3b352cec",
      administrador: false,
    });
    expect(r.statusCode).toBe(201);
    const lista = (await req("GET", "/api/admin/usuarios", admin)).json();
    expect(lista.find((x: any) => x.email === "carla@lume.com")).toMatchObject({
      tipo: "externo",
      cliente_nome: "Lume",
    });
    const admExterno = await req("POST", "/api/admin/usuarios", admin, {
      nome: "Y",
      email: "y@lume.com",
      perfil_id: perfil.id,
      administrador: true,
    });
    expect(admExterno.statusCode).toBe(400);
    // o token do usuário externo leva tipo e cliente
    await portal.banco.query(
      "UPDATE usuarios SET senha_hash = (SELECT senha_hash FROM usuarios WHERE email = 'admin@portal.teste'), precisa_trocar_senha = false WHERE email = 'carla@lume.com'",
    );
    const c = await entrar(portal.app, "carla@lume.com");
    const eco = (await req("GET", "/cronogramas/api/eco", c)).json();
    expect(eco.usuario).toMatchObject({ tipo: "externo", permissoes: ["cronogramas.ver"] });
    const clientes = (await req("GET", "/api/portal/clientes", admin)).json();
    expect(clientes[0]).toMatchObject({ nome: "Lume", usuarios: 1 });
    expect((await req("GET", "/api/portal/clientes", c)).statusCode).toBe(403);
  });

  it("quem não é administrador não administra", async () => {
    const c = await entrar(portal.app, "projetos@portal.teste");
    expect((await req("GET", "/api/admin/usuarios", c)).statusCode).toBe(403);
    expect((await req("POST", "/api/portal/importacao/cronogramas", c, { dados: {} })).statusCode).toBe(403);
  });
});

describe("saúde dos módulos", () => {
  it("versão, situação e modo de login; endereço interno só para o administrador", async () => {
    const r = (await req("GET", "/api/portal/modulos", admin)).json();
    const cr = r.modulos.find((m: any) => m.id === "cronogramas");
    expect(cr).toMatchObject({ versao: "9.9.9", autenticacao: "portal", fonteManifesto: "ao-vivo", url: cron.url });
    expect(cr.saude.ok).toBe(true);
    const cp = r.modulos.find((m: any) => m.id === "cp");
    expect(cp).toMatchObject({ autenticacao: null, fonteManifesto: null });
    expect(cp.saude.ok).toBe(false);

    const fin = await entrar(portal.app, "financeiro@portal.teste");
    const vista = (await req("GET", "/api/portal/modulos", fin)).json();
    expect(vista.modulos[0].url).toBeUndefined();
    const proj = await entrar(portal.app, "projetos@portal.teste");
    expect((await req("GET", "/api/portal/modulos", proj)).statusCode).toBe(403);
  });

  it("verificar agora relê e avisa permissões novas desde o início", async () => {
    const r = (await req("POST", "/api/portal/modulos/atualizar", admin)).json();
    expect(r.ultimaAtualizacao).toBeTruthy();
    expect(r.catalogo).toEqual({ novas: [], removidas: [] });
  });
});
