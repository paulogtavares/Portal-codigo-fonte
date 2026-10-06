/**
 * Repasse aos módulos (etapa 3): prefixo, token por requisição com o aud do módulo, cookie do portal nunca repassado,
 * Set-Cookie dos módulos descartado, e o próprio módulo (kit no modo portal) recusando sem token ou com token de
 * outro módulo.
 */
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emitirToken } from "plataforma-kit/portal";
import { corpoToken, entrar, montarPortal, SEGREDO, subirModulo, type ModuloTeste } from "./apoio.ts";

let cron: ModuloTeste;
let orc: ModuloTeste;
let portal: Awaited<ReturnType<typeof montarPortal>>;
let admin: string;
let projetos: string;
let financeiro: string;

beforeAll(async () => {
  cron = await subirModulo({ id: "cronogramas" });
  orc = await subirModulo({ id: "orcamentos", prefixo: "/financeiro/orcamentos" });
  portal = await montarPortal({ modulos: [cron, orc] });
  admin = await entrar(portal.app, "admin@portal.teste");
  projetos = await entrar(portal.app, "projetos@portal.teste");
  financeiro = await entrar(portal.app, "financeiro@portal.teste");
});
afterAll(async () => {
  await portal.app.close();
  await cron.fechar();
  await orc.fechar();
});

const ultima = (m: ModuloTeste) => m.recebidas[m.recebidas.length - 1];

describe("repasse por prefixo", () => {
  it("usa o prefixo do manifesto, tira o prefixo do caminho e informa X-Forwarded-Prefix", async () => {
    const r = await portal.app.inject({
      url: "/financeiro/orcamentos/api/eco?x=1&y=2",
      headers: { cookie: financeiro },
    });
    expect(r.statusCode).toBe(200);
    const recebida = ultima(orc);
    expect(recebida.url).toBe("/api/eco?x=1&y=2");
    expect(recebida.cabecalhos["x-forwarded-prefix"]).toBe("/financeiro/orcamentos");
  });

  it("emite um token novo a cada requisição, com aud do módulo e só as permissões dele", async () => {
    await portal.app.inject({ url: "/financeiro/orcamentos/api/eco", headers: { cookie: financeiro } });
    const t1 = ultima(orc).cabecalhos["x-plataforma-token"];
    await new Promise((r) => setTimeout(r, 1100));
    await portal.app.inject({ url: "/financeiro/orcamentos/api/eco", headers: { cookie: financeiro } });
    const t2 = ultima(orc).cabecalhos["x-plataforma-token"];
    expect(t1).not.toBe(t2);
    const c = corpoToken(t2);
    expect(c.aud).toBe("orcamentos");
    expect(c.iss).toBe("portal");
    expect(c.exp - c.iat).toBeLessThanOrEqual(60);
    expect(c.permissoes.length).toBeGreaterThan(0);
    expect(c.permissoes.every((p: string) => p.startsWith("orcamentos."))).toBe(true);
  });

  it("o módulo identifica a pessoa pelo token (mesmo id do portal)", async () => {
    const eu = await portal.app.inject({ url: "/api/eu", headers: { cookie: financeiro } });
    const r = await portal.app.inject({ url: "/financeiro/orcamentos/api/eco", headers: { cookie: financeiro } });
    expect(r.json().usuario.id).toBe(eu.json().id);
    expect(r.json().usuario.email).toBe("financeiro@portal.teste");
  });

  it("nunca repassa o cookie do portal nem token, prefixo ou autorização vindos do navegador", async () => {
    const r = await portal.app.inject({
      url: "/cronogramas/api/eco",
      headers: {
        cookie: `${projetos}; outro=1`,
        "x-plataforma-token": "forjado",
        "x-forwarded-prefix": "/malicioso",
        authorization: "Basic abc",
      },
    });
    expect(r.statusCode).toBe(200);
    const h = ultima(cron).cabecalhos;
    expect(h.cookie).toBeUndefined();
    expect(h.authorization).toBeUndefined();
    expect(h["x-plataforma-token"]).not.toBe("forjado");
    expect(h["x-forwarded-prefix"]).toBe("/cronogramas");
  });

  it("repassa o corpo (POST) e devolve a resposta do módulo", async () => {
    const r = await portal.app.inject({
      method: "POST",
      url: "/cronogramas/api/eco",
      headers: { cookie: projetos, "content-type": "application/json" },
      payload: { nome: "Cronograma X", itens: [1, 2, 3] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().corpo).toEqual({ nome: "Cronograma X", itens: [1, 2, 3] });
  });

  it("descarta Set-Cookie do módulo (nenhum módulo grava ou apaga o cookie do portal)", async () => {
    const r = await portal.app.inject({
      method: "POST",
      url: "/cronogramas/api/sair-local",
      headers: { cookie: admin },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers["set-cookie"]).toBeUndefined();
  });

  it("ajusta o Location do módulo ao prefixo", async () => {
    const r = await portal.app.inject({ url: "/cronogramas/api/redirecionar", headers: { cookie: admin } });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe("/cronogramas/outra-tela");
  });

  it("navegação direta (fora do iframe) abre a mesma tela dentro do portal", async () => {
    const r = await portal.app.inject({
      url: "/cronogramas/modelos?aba=2",
      headers: { cookie: admin, "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" },
    });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe("/m/cronogramas/modelos?aba=2");
    const iframe = await portal.app.inject({
      url: "/cronogramas/",
      headers: { cookie: admin, "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" },
    });
    expect(iframe.statusCode).toBe(200);
    expect(iframe.body).toBe("tela do módulo");
  });

  it("caminho com .. é recusado (endereço cru, como chega pela rede)", async () => {
    const endereco = await portal.app.listen({ port: 0, host: "127.0.0.1" });
    for (const caminho of ["/cronogramas/%2e%2e/api/eu", "/cronogramas/../api/eu", "/cronogramas/x/..%2f..%2fapi"]) {
      const status = await new Promise<number>((ok, falha) => {
        const u = new URL(endereco);
        http
          .request({ host: u.hostname, port: u.port, path: caminho, headers: { cookie: admin } }, (r) => {
            r.resume();
            ok(r.statusCode ?? 0);
          })
          .on("error", falha)
          .end();
      });
      expect(status, caminho).toBe(400);
    }
  });
});

describe("recusas do portal", () => {
  it("sem sessão: 401 em JSON para a API e página que avisa o portal para as telas", async () => {
    const api = await portal.app.inject({ url: "/cronogramas/api/eco" });
    expect(api.statusCode).toBe(401);
    expect(api.json().erro).toMatch(/sessão/);
    const tela = await portal.app.inject({ url: "/cronogramas/", headers: { accept: "text/html" } });
    expect(tela.statusCode).toBe(401);
    expect(tela.body).toContain("sessao-expirada");
    expect(tela.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("perfil sem nenhuma permissão do módulo: 403, sem chegar ao módulo", async () => {
    const antes = cron.recebidas.length;
    const r = await portal.app.inject({ url: "/cronogramas/api/eco", headers: { cookie: financeiro } });
    expect(r.statusCode).toBe(403);
    expect(cron.recebidas.length).toBe(antes);
  });

  it("módulo fora do ar: 502 com mensagem", async () => {
    const fora = await subirModulo({ id: "cp" });
    const p = await montarPortal({ modulos: [fora] });
    await fora.fechar();
    const c = await entrar(p.app, "admin@portal.teste");
    const r = await p.app.inject({ url: "/cp/api/eco", headers: { cookie: c } });
    expect(r.statusCode).toBe(502);
    expect(r.json().erro).toMatch(/fora do ar/);
    await p.app.close();
  });

  it("módulo com login próprio (AUTH_MODO=local): 409 e fora do menu", async () => {
    const local = await subirModulo({ id: "cp", autenticacao: "local" });
    const p = await montarPortal({ modulos: [local] });
    const c = await entrar(p.app, "admin@portal.teste");
    const r = await p.app.inject({ url: "/cp/api/eco", headers: { cookie: c } });
    expect(r.statusCode).toBe(409);
    expect((await p.app.inject({ url: "/api/portal/menu", headers: { cookie: c } })).json()).toEqual([]);
    await p.app.close();
    await local.fechar();
  });

  it("sem SEGREDO_PLATAFORMA (uso local): o portal sobe e o repasse responde 503", async () => {
    const p = await montarPortal({ modulos: [cron], env: { SEGREDO_PLATAFORMA: undefined } });
    const c = await entrar(p.app, "admin@portal.teste");
    const r = await p.app.inject({ url: "/cronogramas/api/eco", headers: { cookie: c } });
    expect(r.statusCode).toBe(503);
    expect(p.logs.some((l) => l.includes("SEGREDO_PLATAFORMA"))).toBe(true);
    await p.app.close();
  });

  it("sem SEGREDO_PLATAFORMA em nuvem: o portal não sobe", async () => {
    await expect(
      montarPortal({ env: { SEGREDO_PLATAFORMA: undefined, NODE_ENV: "production", MODO_TESTE: undefined } }),
    ).rejects.toThrow(/SEGREDO_PLATAFORMA/);
  });
});

describe("o módulo (kit no modo portal) recusa acessos fora do portal", () => {
  const usuario = {
    id: "5b1e7c1e-3f7a-4c2a-9a55-0d6f3c2b9e11",
    email: "pessoa@exemplo.com",
    nome: "Pessoa",
    tipo: "interno" as const,
    permissoes: ["cronogramas.ver", "orcamentos.ver"],
  };

  it("sem token: 401", async () => {
    const r = await fetch(`${cron.url}/api/eco`);
    expect(r.status).toBe(401);
  });

  it("com token emitido para outro módulo: 401", async () => {
    const t = await emitirToken(usuario, "orcamentos", { segredo: SEGREDO });
    const r = await fetch(`${cron.url}/api/eco`, { headers: { "x-plataforma-token": t } });
    expect(r.status).toBe(401);
  });

  it("com token assinado por outro segredo: 401", async () => {
    const t = await emitirToken(usuario, "cronogramas", { segredo: "outro-segredo-qualquer-com-mais-de-32-letras" });
    const r = await fetch(`${cron.url}/api/eco`, { headers: { "x-plataforma-token": t } });
    expect(r.status).toBe(401);
  });

  it("com token expirado: 401", async () => {
    const t = await emitirToken(usuario, "cronogramas", { segredo: SEGREDO, agora: Date.now() - 10 * 60_000 });
    const r = await fetch(`${cron.url}/api/eco`, { headers: { "x-plataforma-token": t } });
    expect(r.status).toBe(401);
  });

  it("com o token do portal para ele: aceito", async () => {
    const t = await emitirToken(usuario, "cronogramas", { segredo: SEGREDO });
    const r = await fetch(`${cron.url}/api/eco`, { headers: { "x-plataforma-token": t } });
    expect(r.status).toBe(200);
    expect((await r.json()).usuario.permissoes).toEqual(["cronogramas.ver"]);
  });
});
