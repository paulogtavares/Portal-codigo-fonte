/**
 * Portal da plataforma — ponto de entrada.
 *   npm run dev -w api    (código-fonte; Node 24 roda o TypeScript direto)
 *   node server.js        (pacote, gerado por npm run empacotar)
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { lerAmbiente } from "plataforma-kit/ambiente";
import { abrirEmbutido, abrirPostgres } from "./banco.ts";
import { criarApp, lerVersao } from "./app.ts";
import { MODULO } from "./permissoes.ts";

const log = (m: string) => console.log(new Date().toLocaleTimeString("pt-BR"), m);

async function iniciar() {
  const amb = lerAmbiente({ modulo: MODULO, cookiePadrao: "portal_sessao" }, { ...process.env, AUTH_MODO: "local" });
  const url = process.env.DATABASE_URL?.trim();
  if (amb.producao && !url) throw new Error("NODE_ENV=production exige DATABASE_URL (PostgreSQL).");
  // front compilado: public/ ao lado do server.js (pacote) ou dist/public na raiz (código-fonte, depois do build)
  const raiz = [new URL("./", import.meta.url), new URL("../../dist/", import.meta.url)]
    .map((u) => fileURLToPath(u))
    .find((p) => existsSync(join(p, "public", "index.html")));
  const dados = resolve(amb.dadosDir ?? join(process.cwd(), "dados"));
  const banco = url ? await abrirPostgres(url) : await abrirEmbutido(join(dados, "pglite"));
  log(url ? "Banco: PostgreSQL (schema portal)" : `Banco: embutido em ${join(dados, "pglite")} (schema portal)`);

  const { versao, data } = lerVersao();
  const { app } = await criarApp({ banco, versao, data, pastaFront: raiz, log });
  const porta = amb.porta ?? 3030;
  try {
    await app.listen({ port: porta, host: amb.host });
  } catch (e) {
    await banco.fechar().catch(() => {});
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE")
      throw new Error(
        `a porta ${porta} já está em uso (talvez o portal já esteja aberto). ` +
          "Feche o outro programa ou defina outra porta no .env (ex.: PORT=4030).",
      );
    throw e;
  }
  const local = ["127.0.0.1", "0.0.0.0", "localhost", "::1"].includes(amb.host);
  const endereco = `http://${local ? "localhost" : amb.host}:${porta}`;
  console.log(`\n  Portal da plataforma v${versao} (${data})\n  Endereço: ${endereco}\n`);
  // iniciar.bat / iniciar.sh pedem para abrir o navegador: só depois que a porta foi ocupada
  if (local && process.env.ABRIR_NAVEGADOR === "1") abrirNavegador(endereco);
  if (!amb.producao) {
    const { rows } = await banco.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM usuarios WHERE ativo AND senha_hash IS NOT NULL",
    );
    if (rows[0].n === 0)
      console.log(
        "  Ninguém consegue entrar ainda: falta o arquivo .env ao lado do server.js.\n" +
          "  Rode pelo iniciar.bat (ele cria o .env com usuários de teste: admin@portal.teste / teste123)\n" +
          "  ou defina ADMIN_EMAIL e ADMIN_SENHA no .env e reinicie.\n",
      );
    else if (amb.modoTeste) console.log("  Usuários de teste liberados: admin@portal.teste, senha teste123.\n");
  }

  const encerrar = async () => {
    await app.close().catch(() => {});
    await banco.fechar().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", encerrar);
  process.on("SIGTERM", encerrar);
}

function abrirNavegador(url: string) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true })
      .on("error", () => console.log(`  Abra ${url} no navegador.`))
      .unref();
  } catch {
    console.log(`  Abra ${url} no navegador.`);
  }
}

iniciar().catch((e) => {
  console.error(`\n  Erro ao iniciar: ${e?.message ?? e}\n`);
  process.exit(1);
});
