/**
 * Apoio dos testes: o portal com PGlite em memória e módulos de teste DE VERDADE (Fastify + kit no modo portal:
 * criarSessao, prepararServidor e a validação do token do próprio kit), ouvindo numa porta local.
 */
import Fastify, { type FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";
import { scriptIdentidade } from "plataforma-kit/identidade";
import { criarCatalogo } from "plataforma-kit/permissoes";
import { prepararServidor } from "plataforma-kit/servidor";
import { criarSessao } from "plataforma-kit/sessao";
import { abrirEmbutido, abrirPostgres, type BancoModulo } from "../src/banco.ts";
import { criarApp, SENHA_TESTE } from "../src/app.ts";

export const SEGREDO = "segredo-dos-testes-da-plataforma-com-mais-de-32";

export interface ModuloTeste {
  id: string;
  url: string;
  app: FastifyInstance;
  /** cabeçalhos e corpo das requisições recebidas */
  recebidas: { metodo: string; url: string; cabecalhos: Record<string, any>; corpo?: unknown }[];
  fechar(): Promise<void>;
}

/**
 * Sobe um módulo de teste com o kit no modo portal (ou local). Rotas extras:
 *   GET/POST /api/eco         devolve o usuário do token (kit) e o que chegou
 *   POST     /api/sair-local  responde com Set-Cookie (o portal precisa descartar)
 *   GET      /api/redirecionar responde 302 para /outra-tela
 */
export async function subirModulo(
  o: {
    id?: string;
    nome?: string;
    prefixo?: string;
    autenticacao?: "portal" | "local";
    segredo?: string;
    porta?: number;
    /** área do menu do portal (manifesto "grupo") */
    grupo?: string;
    /** permissões além de <id>.ver e <id>.editar (ex.: simular a versão nova de um módulo) */
    extras?: string[];
  } = {},
): Promise<ModuloTeste> {
  const id = o.id ?? "cronogramas";
  const catalogo = criarCatalogo(id, [
    { chave: `${id}.ver`, grupo: "Geral", nome: "Ver", descricao: "Ver" },
    { chave: `${id}.editar`, grupo: "Geral", nome: "Editar", descricao: "Editar" },
    ...(o.extras ?? []).map((chave) => ({ chave, grupo: "Novas", nome: chave, descricao: chave })),
  ]);
  const banco = await abrirEmbutido();
  await banco.motor.exec(scriptIdentidade().sql);
  const sessao = criarSessao({
    banco,
    todasPermissoes: catalogo.todas,
    modo: o.autenticacao ?? "portal",
    nomeCookie: `${id}_sessao`,
    modulo: id,
    segredoPlataforma: o.segredo ?? SEGREDO,
  });
  const app = Fastify({ logger: false });
  const recebidas: ModuloTeste["recebidas"] = [];
  app.addHook("onRequest", async (req) => {
    recebidas.push({ metodo: req.method, url: req.url, cabecalhos: { ...req.headers } });
  });
  await prepararServidor(app, {
    sessao,
    banco,
    producao: false,
    versao: "9.9.9",
    data: "2026-10-05",
    tipoBanco: () => "embutido",
    permissoes: catalogo.lista,
    manifesto: {
      id,
      nome: o.nome ?? `Módulo ${id}`,
      prefixo: o.prefixo ?? `/${id}`,
      ...(o.grupo ? { grupo: o.grupo } : {}),
      saude: "/api/saude",
      menu: [
        { id: "inicio", rotulo: "Início", caminho: "/" },
        { id: "editar", rotulo: "Editar", caminho: "/editar", exigeAlguma: [`${id}.editar`] },
        { id: "usuarios", rotulo: "Usuários e perfis", caminho: "/usuarios", somenteAdministrador: true },
      ],
    },
    log: () => {},
  });
  const eco = async (req: any) => {
    recebidas[recebidas.length - 1].corpo = req.body;
    return { usuario: req.usuario, cabecalhos: req.headers, corpo: req.body ?? null };
  };
  app.get("/api/eco", eco);
  app.post("/api/eco", eco);
  app.post("/api/sair-local", { config: { publica: true } }, async (_req, reply) => {
    reply.header("Set-Cookie", "portal_sessao=; Path=/; Max-Age=0");
    return { ok: true };
  });
  app.get("/api/redirecionar", { config: { publica: true } }, async (_req, reply) => reply.redirect("/outra-tela"));
  app.get("/", { config: { publica: true } }, async () => "tela do módulo");
  await app.listen({ port: o.porta ?? 0, host: "127.0.0.1" });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return {
    id,
    url,
    app,
    recebidas,
    fechar: async () => {
      await app.close();
      await banco.fechar();
    },
  };
}

/**
 * Banco vazio para um portal de teste: PGlite em memória ou, com TESTE_DATABASE_URL (npm run test:postgres),
 * um PostgreSQL de verdade com o schema portal apagado antes.
 */
export async function bancoNovo(): Promise<BancoModulo> {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) return abrirEmbutido();
  const banco = await abrirPostgres(url);
  await banco.motor.exec("DROP SCHEMA IF EXISTS portal CASCADE");
  return banco;
}

export async function montarPortal(
  o: { env?: Record<string, string | undefined>; banco?: BancoModulo; modulos?: ModuloTeste[] } = {},
) {
  const banco = o.banco ?? (await bancoNovo());
  const logs: string[] = [];
  const env: NodeJS.ProcessEnv = {
    MODO_TESTE: "1",
    SEGREDO_PLATAFORMA: SEGREDO,
    MODULOS: (o.modulos ?? []).map((m) => `${m.id}=${m.url}`).join(","),
    ...o.env,
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  const r = await criarApp({
    banco,
    env,
    versao: "1.0.0-teste",
    data: "2026-10-05",
    releituraPeriodica: false,
    log: (m) => logs.push(m),
  });
  // banco criado aqui fecha junto com o portal (quem passa o banco reaproveita depois, para simular um reinício)
  if (!o.banco) r.app.addHook("onClose", async () => banco.fechar());
  await r.app.ready();
  return { ...r, banco, logs };
}

/** Login no portal; devolve o cookie "portal_sessao=…". */
export async function entrar(app: FastifyInstance, email: string, senha = SENHA_TESTE) {
  const r = await app.inject({ method: "POST", url: "/api/auth/entrar", payload: { email, senha } });
  if (r.statusCode !== 200) throw new Error(`login ${email}: ${r.statusCode} ${r.body}`);
  const c = r.headers["set-cookie"];
  return String(Array.isArray(c) ? c[0] : c).split(";")[0];
}

/** Decodifica o corpo de um JWT (sem conferir), para olhar as declarações nos testes. */
export const corpoToken = (t: string) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8"));
