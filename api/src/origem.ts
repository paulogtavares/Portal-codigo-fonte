/**
 * Conferência de origem: requisições que alteram dados (tudo menos GET, HEAD e OPTIONS) só são aceitas quando vêm do
 * próprio portal. Vale para a API do portal e para o repasse aos módulos. É um reforço ao SameSite=Lax do cookie.
 *  - Sec-Fetch-Site presente (navegadores atuais): precisa ser "same-origin";
 *  - senão, Origin presente: precisa ter o mesmo host da requisição;
 *  - sem nenhum dos dois (ferramentas como curl, que não carregam o cookie de outro site): aceita.
 */
import type { FastifyInstance } from "fastify";

const SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

export function origemPermitida(metodo: string, cabecalhos: Record<string, string | string[] | undefined>) {
  if (SEGUROS.has(metodo.toUpperCase())) return true;
  const site = cabecalhos["sec-fetch-site"];
  if (typeof site === "string") return site === "same-origin";
  const origem = cabecalhos.origin;
  if (typeof origem === "string") {
    if (origem === "null") return false;
    try {
      return new URL(origem).host === String(cabecalhos.host ?? "");
    } catch {
      return false;
    }
  }
  return true;
}

export function registrarConferenciaDeOrigem(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    if (!origemPermitida(req.method, req.headers))
      return reply.code(403).send({ erro: "Requisição recusada: ela não veio do próprio portal." });
  });
}
