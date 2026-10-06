/**
 * Estrutura e migrações do schema portal, lidas da pasta db/ (no código-fonte: ../../db; no pacote: ./db,
 * ao lado do server.js). Aplicadas pelo migrador do kit, que cria o schema, aplica a identidade do kit antes da
 * estrutura do portal e registra tudo em portal.migracoes.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { migrar, type Script } from "plataforma-kit/migrador";
import { scriptIdentidade } from "plataforma-kit/identidade";
import { SCHEMA, type BancoModulo } from "./banco.ts";

export function pastaDb(): string {
  const candidatas = [new URL("../../db/", import.meta.url), new URL("./db/", import.meta.url)].map((u) =>
    fileURLToPath(u),
  );
  const achada = candidatas.find((p) => existsSync(join(p, "01_estrutura.sql")));
  if (!achada) throw new Error(`Pasta db/ não encontrada (procurada em: ${candidatas.join(", ")}).`);
  return achada;
}

const ler = (pasta: string, nome: string): Script => ({ nome, sql: readFileSync(join(pasta, nome), "utf8") });

export function scriptsDoPortal(pasta = pastaDb()) {
  const base = ["01_estrutura.sql"].map((n) => ler(pasta, n));
  const dirMigracoes = join(pasta, "migracoes");
  const migracoes = existsSync(dirMigracoes)
    ? readdirSync(dirMigracoes)
        .filter((n) => /^\d+_.+\.sql$/.test(n))
        .sort()
        .map((n) => ({ ...ler(dirMigracoes, n), nome: `migracoes/${n}` }))
    : [];
  return { base, migracoes };
}

export async function aplicarMigracoes(banco: BancoModulo, log: (m: string) => void) {
  const { base, migracoes } = scriptsDoPortal();
  return migrar(banco.motor, {
    schema: SCHEMA,
    tabelaReferencia: `${SCHEMA}.modulos`,
    identidade: scriptIdentidade(),
    base,
    migracoes,
    log,
  });
}
