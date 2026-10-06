/**
 * v1.0.0-alpha.2: ajustes da revisão de 06/10/2026 — catálogo sem reiniciar (kit 1.6.0), áreas do menu (grupo),
 * conferência de origem, trustProxy só no proxy da frente e contas de teste do Cronogramas na importação.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gerarHashSenha } from "plataforma-kit/seguranca";
import { origemPermitida } from "../src/origem.ts";
import { entrar, montarPortal, subirModulo, type ModuloTeste } from "./apoio.ts";

describe("catálogo lido a cada requisição (kit 1.6.0)", () => {
  it("permissão nova de um módulo atualizado vale nos perfis sem reiniciar o portal", async () => {
    const v1 = await subirModulo({ id: "orcamentos", grupo: "Financeiro" });
    const porta = Number(new URL(v1.url).port);
    const p = await montarPortal({ modulos: [v1] });
    const c = await entrar(p.app, "admin@portal.teste");
    const salvar = () =>
      p.app.inject({
        method: "POST",
        url: "/api/admin/perfis",
        headers: { cookie: c },
        payload: { nome: `Clientes ${Date.now()}`, permissoes: ["portal.interno", "orcamentos.clientes.ver"] },
      });
    expect((await salvar()).statusCode).toBe(400);
    await v1.fechar();
    const v2 = await subirModulo({ id: "orcamentos", grupo: "Financeiro", extras: ["orcamentos.clientes.ver"], porta });
    await p.app.inject({ method: "POST", url: "/api/portal/modulos/atualizar", headers: { cookie: c } });
    const perms = (await p.app.inject({ url: "/api/admin/permissoes", headers: { cookie: c } })).json();
    expect(perms.find((x: any) => x.chave === "orcamentos.clientes.ver")).toMatchObject({ modulo: "orcamentos" });
    expect((await salvar()).statusCode).toBe(201);
    await p.app.close();
    await v2.fechar();
  });
});

describe("áreas do menu", () => {
  let cron: ModuloTeste;
  let orc: ModuloTeste;
  afterAll(async () => {
    await cron?.fechar();
    await orc?.fechar();
  });
  it("o menu e a tela Módulos levam o grupo do manifesto", async () => {
    cron = await subirModulo({ id: "cronogramas" });
    orc = await subirModulo({ id: "orcamentos", grupo: "Financeiro" });
    const p = await montarPortal({ modulos: [cron, orc] });
    const c = await entrar(p.app, "admin@portal.teste");
    const menu = (await p.app.inject({ url: "/api/portal/menu", headers: { cookie: c } })).json();
    expect(menu.map((m: any) => [m.id, m.grupo])).toEqual([
      ["cronogramas", null],
      ["orcamentos", "Financeiro"],
    ]);
    const mods = (await p.app.inject({ url: "/api/portal/modulos", headers: { cookie: c } })).json();
    expect(mods.modulos[1].grupo).toBe("Financeiro");
    await p.app.close();
  });
});

describe("conferência de origem", () => {
  it("regras", () => {
    expect(origemPermitida("GET", { "sec-fetch-site": "cross-site" })).toBe(true);
    expect(origemPermitida("POST", { "sec-fetch-site": "same-origin" })).toBe(true);
    expect(origemPermitida("POST", { "sec-fetch-site": "cross-site" })).toBe(false);
    expect(origemPermitida("DELETE", { "sec-fetch-site": "same-site" })).toBe(false);
    expect(origemPermitida("POST", { origin: "https://portal.exemplo", host: "portal.exemplo" })).toBe(true);
    expect(origemPermitida("POST", { origin: "https://mal.exemplo", host: "portal.exemplo" })).toBe(false);
    expect(origemPermitida("POST", { origin: "null", host: "portal.exemplo" })).toBe(false);
    expect(origemPermitida("POST", {})).toBe(true);
  });

  it("vale para a API do portal e para o repasse aos módulos", async () => {
    const cron = await subirModulo({ id: "cronogramas" });
    const p = await montarPortal({ modulos: [cron] });
    const c = await entrar(p.app, "admin@portal.teste");
    const antes = cron.recebidas.length;
    const outroSite = { cookie: c, "sec-fetch-site": "cross-site", "content-type": "application/json" };
    const proxy = await p.app.inject({ method: "POST", url: "/cronogramas/api/eco", headers: outroSite, payload: {} });
    expect(proxy.statusCode).toBe(403);
    expect(cron.recebidas.length).toBe(antes);
    const api = await p.app.inject({
      method: "POST",
      url: "/api/admin/perfis",
      headers: outroSite,
      payload: { nome: "X", permissoes: [] },
    });
    expect(api.statusCode).toBe(403);
    const login = await p.app.inject({
      method: "POST",
      url: "/api/auth/entrar",
      headers: { origin: "https://mal.exemplo", host: "localhost:3030" },
      payload: { email: "admin@portal.teste", senha: "teste123" },
    });
    expect(login.statusCode).toBe(403);
    const mesma = await p.app.inject({
      method: "POST",
      url: "/cronogramas/api/eco",
      headers: { ...outroSite, "sec-fetch-site": "same-origin" },
      payload: { ok: 1 },
    });
    expect(mesma.statusCode).toBe(200);
    await p.app.close();
    await cron.fechar();
  });
});

describe("trustProxy só no proxy da frente", () => {
  it("um X-Forwarded-For inventado não vira o IP repassado ao módulo", async () => {
    const cron = await subirModulo({ id: "cronogramas" });
    const p = await montarPortal({ modulos: [cron] });
    const c = await entrar(p.app, "admin@portal.teste");
    // navegador inventa 1.1.1.1; o proxy da frente (Railway) acrescenta o IP real 203.0.113.9
    await p.app.inject({
      url: "/cronogramas/api/eco",
      headers: { cookie: c, "x-forwarded-for": "1.1.1.1, 203.0.113.9" },
      remoteAddress: "10.0.0.2",
    });
    const xff = cron.recebidas[cron.recebidas.length - 1].cabecalhos["x-forwarded-for"];
    expect(xff.split(",")[0].trim()).toBe("203.0.113.9");
    await p.app.close();
    await cron.fechar();
  });
});

describe("contas de teste do Cronogramas na importação", () => {
  let dados: any;
  beforeAll(async () => {
    const teste = await gerarHashSenha("teste123");
    const real = await gerarHashSenha("Senha-Real-2026");
    const base = { tipo: "interno", cliente_id: null, ativo: true, perfil_id: null, precisa_trocar_senha: false };
    dados = {
      origem: "cronogramas",
      clientes: [],
      perfis: [],
      usuarios: [
        {
          ...base,
          id: "c882e72d-e5d2-478a-88de-8eb13c168b3a",
          nome: "Ana",
          email: "ana.souza@exemplo.com.br",
          administrador: true,
          senha_hash: teste,
        },
        {
          ...base,
          id: "a7911efc-c865-41a3-aab9-d9985ef8bbb0",
          nome: "Dani",
          email: "dani@infracommerce.com.br",
          administrador: false,
          senha_hash: teste,
        },
        {
          ...base,
          id: "da721a6a-73ef-4e9d-9bf3-3a4bfdff142d",
          nome: "Eva",
          email: "eva@infracommerce.com.br",
          administrador: false,
          senha_hash: real,
        },
      ],
    };
  });

  it("em produção: e-mail de teste ou senha teste123 entram inativos, sem senha e sem administrador", async () => {
    const p = await montarPortal({
      env: { NODE_ENV: "production", MODO_TESTE: undefined, ADMIN_EMAIL: "paulo@x.com", ADMIN_SENHA: "Senha#Forte123" },
    });
    await p.banco.query("UPDATE usuarios SET precisa_trocar_senha = false");
    const c = await entrar(p.app, "paulo@x.com", "Senha#Forte123");
    const r = (
      await p.app.inject({
        method: "POST",
        url: "/api/portal/importacao/cronogramas",
        headers: { cookie: c },
        payload: { dados, simular: false },
      })
    ).json();
    expect(r.usuarios.contasTeste.map((t: any) => [t.email, t.bloqueada])).toEqual([
      ["ana.souza@exemplo.com.br", true],
      ["dani@infracommerce.com.br", true],
    ]);
    const { rows } = await p.banco.query(
      "SELECT email, ativo, administrador, senha_hash IS NOT NULL AS tem_senha FROM usuarios WHERE email <> 'paulo@x.com' ORDER BY email",
    );
    expect(rows).toEqual([
      { email: "ana.souza@exemplo.com.br", ativo: false, administrador: false, tem_senha: false },
      { email: "dani@infracommerce.com.br", ativo: false, administrador: false, tem_senha: false },
      { email: "eva@infracommerce.com.br", ativo: true, administrador: false, tem_senha: true },
    ]);
    await expect(entrar(p.app, "ana.souza@exemplo.com.br")).rejects.toThrow(/401/);
    await p.app.close();
  });

  it("no computador: entram normalmente, com aviso", async () => {
    const p = await montarPortal();
    const c = await entrar(p.app, "admin@portal.teste");
    const r = (
      await p.app.inject({
        method: "POST",
        url: "/api/portal/importacao/cronogramas",
        headers: { cookie: c },
        payload: { dados, simular: true },
      })
    ).json();
    expect(r.usuarios.contasTeste.every((t: any) => !t.bloqueada)).toBe(true);
    expect(r.avisos.join(" ")).toMatch(/Em produção elas entram inativas/);
    await p.app.close();
  });
});
