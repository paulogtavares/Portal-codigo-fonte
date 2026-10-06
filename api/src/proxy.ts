/**
 * Repasse aos módulos (Plano 4, etapa 3).
 *
 * Toda requisição cujo caminho começa com o prefixo de um módulo (ex.: /cronogramas/...) vai para o endereço interno
 * dele, com:
 *   - o prefixo removido do caminho e informado em X-Forwarded-Prefix (o módulo monta o <base href> com ele);
 *   - um X-Plataforma-Token NOVO a cada requisição, emitido pelo kit para o usuário da sessão do portal, com
 *     aud = id do módulo e só as permissões daquele módulo;
 *   - SEM o cookie do portal (nenhum cookie vai para o módulo) e sem cabeçalhos de token ou prefixo vindos do
 *     navegador;
 *   - a resposta volta sem Set-Cookie (no modo portal os módulos não usam cookie, e assim nenhum módulo consegue
 *     gravar ou apagar o cookie do portal) e com Location ajustado ao prefixo.
 * Corre no onRequest, antes da leitura do corpo: o corpo segue em fluxo para o módulo, sem limite de tamanho do portal.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import http from "node:http";
import https from "node:https";
import { emitirToken, CABECALHO_TOKEN } from "plataforma-kit/portal";
import type { Sessao } from "plataforma-kit/sessao";
import type { Registro } from "./modulos.ts";
import { temVisao } from "./menu.ts";
import type { UsuarioPortal } from "./permissoes.ts";

export interface OpcoesProxy {
  registro: Registro;
  sessao: Sessao<any>;
  /** SEGREDO_PLATAFORMA; sem ele o repasse responde 503 */
  segredo: string | undefined;
  /** validade de cada token emitido, em segundos (padrão do kit: 60) */
  validadeToken?: number;
  /** tempo máximo sem resposta do módulo (padrão 60 s) */
  tempoLimiteMs?: number;
  log: (m: string) => void;
}

/** Cabeçalhos que não atravessam um proxy (RFC 9110) e os que o portal nunca repassa. */
const SALTO = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const NUNCA_PARA_O_MODULO = new Set([
  "host",
  "cookie",
  "authorization",
  CABECALHO_TOKEN,
  "x-forwarded-prefix",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-forwarded-port",
  "forwarded",
  "x-real-ip",
]);
const NUNCA_PARA_O_NAVEGADOR = new Set(["set-cookie"]);

/** ".." ou "%2e%2e" como segmento do caminho */
const SOBE_PASTA = /(^|\/|%2f)(\.|%2e){2}(\/|%2f|$)/i;

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Página curta para o iframe: avisa o portal (mesma origem) ou, fora do iframe, volta ao início do portal. */
function paginaAviso(titulo: string, texto: string, modulo: string, sessaoExpirada: boolean) {
  const script = sessaoExpirada
    ? `<script>
if (window.self !== window.top) window.parent.postMessage({ tipo: "sessao-expirada", modulo: ${JSON.stringify(modulo)} }, window.location.origin);
else window.location.replace("/");
</script>`
    : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(titulo)}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#334}
main{max-width:34rem;padding:1.5rem;text-align:center}h1{font-size:1.15rem}p{color:#556}</style></head>
<body><main><h1>${escapar(titulo)}</h1><p>${escapar(texto)}</p></main>${script}</body></html>`;
}

function querJson(req: FastifyRequest, resto: string) {
  return resto.startsWith("/api/") || !String(req.headers.accept ?? "").includes("text/html");
}

export function registrarProxy(app: FastifyInstance, o: OpcoesProxy) {
  const tempo = o.tempoLimiteMs ?? 60_000;

  function recusar(
    req: FastifyRequest,
    reply: FastifyReply,
    resto: string,
    modulo: string,
    status: number,
    mensagem: string,
    titulo = "Não foi possível abrir",
  ) {
    if (querJson(req, resto)) return reply.code(status).send({ erro: mensagem });
    return reply
      .code(status)
      .header("Content-Type", "text/html; charset=utf-8")
      .header("Cache-Control", "no-store")
      .send(paginaAviso(titulo, mensagem, modulo, status === 401));
  }

  app.addHook("onRequest", async (req, reply) => {
    const [caminho, ...q] = req.url.split("?");
    const alvo = o.registro.porCaminho(caminho);
    if (!alvo) return;
    const { estado, resto } = alvo;
    const consulta = q.length ? `?${q.join("?")}` : "";

    if (SOBE_PASTA.test(caminho)) return reply.code(400).send({ erro: "Endereço inválido." });

    // quem está pedindo: a sessão do portal (cookie portal_sessao); o cookie fica aqui
    let usuario: UsuarioPortal;
    try {
      usuario = await o.sessao.autenticar(req);
    } catch (e: any) {
      const status = e?.status === 403 ? 403 : 401;
      const texto =
        status === 403
          ? "Troque a senha provisória no portal para continuar."
          : "Sua sessão no portal terminou. Entre novamente.";
      return recusar(req, reply, resto, estado.id, status, texto, "Acesso pelo portal");
    }

    // navegação direta (fora do iframe) num endereço de módulo: abre a mesma tela dentro do portal
    if (
      req.method === "GET" &&
      req.headers["sec-fetch-dest"] === "document" &&
      req.headers["sec-fetch-mode"] === "navigate"
    ) {
      return reply.redirect(`/m/${estado.id}${resto}${consulta}`, 302);
    }

    if (!temVisao(usuario, estado.id))
      return recusar(req, reply, resto, estado.id, 403, "Seu perfil não tem acesso a este módulo.");
    if (estado.manifesto && estado.manifesto.autenticacao !== "portal")
      return recusar(
        req,
        reply,
        resto,
        estado.id,
        409,
        `O módulo ${estado.manifesto.nome ?? estado.id} está com login próprio (AUTH_MODO=local) e não pode ser usado pelo portal.`,
      );
    if (!o.segredo)
      return recusar(
        req,
        reply,
        resto,
        estado.id,
        503,
        "O portal está sem SEGREDO_PLATAFORMA: o repasse está desligado.",
      );

    const token = await emitirToken(
      {
        id: usuario.id,
        email: usuario.email,
        nome: usuario.nome,
        tipo: usuario.tipo,
        cliente_id: usuario.cliente_id,
        administrador: usuario.administrador,
        permissoes: usuario.permissoes,
      },
      estado.id,
      { segredo: o.segredo, validadeSegundos: o.validadeToken },
    );

    // cabeçalhos para o módulo
    const cabecalhos: Record<string, string | string[]> = {};
    for (const [nome, valor] of Object.entries(req.headers)) {
      if (valor === undefined || SALTO.has(nome) || NUNCA_PARA_O_MODULO.has(nome)) continue;
      cabecalhos[nome] = valor;
    }
    const destino = new URL(estado.url);
    cabecalhos.host = destino.host;
    cabecalhos["x-forwarded-prefix"] = estado.prefixo;
    cabecalhos["x-forwarded-proto"] = req.protocol;
    cabecalhos["x-forwarded-host"] = String(req.headers.host ?? "");
    cabecalhos["x-forwarded-for"] = req.ips?.length ? [...req.ips].reverse().join(", ") : req.ip;
    cabecalhos[CABECALHO_TOKEN] = token;

    const base = destino.pathname.replace(/\/+$/, "");
    const caminhoModulo = `${base}${resto}${consulta}`;
    const cliente = destino.protocol === "https:" ? https : http;

    reply.hijack();
    const saida = reply.raw;
    const pedido = cliente.request(
      {
        protocol: destino.protocol,
        hostname: destino.hostname,
        port: destino.port || undefined,
        method: req.method,
        path: caminhoModulo,
        headers: cabecalhos,
      },
      (resposta) => {
        const volta: Record<string, string | string[]> = {};
        for (const [nome, valor] of Object.entries(resposta.headers)) {
          if (valor === undefined || SALTO.has(nome) || NUNCA_PARA_O_NAVEGADOR.has(nome)) continue;
          volta[nome] = valor;
        }
        const local = resposta.headers.location;
        if (local) volta.location = ajustarLocation(local, estado.prefixo, destino);
        saida.writeHead(resposta.statusCode ?? 502, volta);
        resposta.pipe(saida);
      },
    );
    pedido.setTimeout(tempo, () => pedido.destroy(Object.assign(new Error("tempo esgotado"), { code: "ETIMEDOUT" })));
    pedido.on("error", (e: any) => {
      o.log(`[proxy] ${estado.id} ${req.method} ${resto}: ${e?.code ?? e?.message}`);
      if (saida.headersSent) return saida.destroy();
      const status = e?.code === "ETIMEDOUT" ? 504 : 502;
      const mensagem =
        status === 504
          ? `O módulo ${estado.id} não respondeu a tempo.`
          : `O módulo ${estado.id} está fora do ar ou inacessível. Tente de novo em instantes.`;
      const json = querJson(req, resto);
      saida.writeHead(status, {
        "content-type": json ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-frame-options": "SAMEORIGIN",
        "content-security-policy": "frame-ancestors 'self'",
      });
      saida.end(
        json ? JSON.stringify({ erro: mensagem }) : paginaAviso("Módulo indisponível", mensagem, estado.id, false),
      );
    });
    // quem pediu desistiu: não segura a conexão com o módulo
    saida.on("close", () => {
      if (!saida.writableFinished) pedido.destroy();
    });
    req.raw.pipe(pedido);
  });
}

/** Location relativo à raiz do módulo (ou absoluto no endereço interno) passa a ficar sob o prefixo do portal. */
export function ajustarLocation(local: string, prefixo: string, destino: URL) {
  if (local.startsWith("/") && !local.startsWith("//")) return `${prefixo}${local}`;
  try {
    const u = new URL(local);
    if (u.origin === destino.origin) {
      const base = destino.pathname.replace(/\/+$/, "");
      const caminho = u.pathname.startsWith(base) ? u.pathname.slice(base.length) || "/" : u.pathname;
      return `${prefixo}${caminho}${u.search}${u.hash}`;
    }
  } catch {
    /* relativo ao recurso atual: o navegador resolve dentro do prefixo */
  }
  return local;
}
