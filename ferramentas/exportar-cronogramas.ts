/**
 * Exporta clientes, perfis e usuários do Cronogramas para o portal importar (Plano 4, etapa 5).
 * Provisória: o Cronogramas v2.2.0 terá a própria exportação, no mesmo formato.
 *
 *   node exportar-cronogramas.js --banco postgres://...        (PostgreSQL do Cronogramas)
 *   node exportar-cronogramas.js --pasta C:\cronogramas\dados  (banco embutido; feche o Cronogramas antes)
 *   opções: --saida arquivo.json (padrão exportacao-cronogramas-AAAA-MM-DD.json)
 *
 * Só lê. Funciona com o schema cronogramas (v2.1.0+) e com o public (até a v2.0.0).
 * O arquivo traz o hash das senhas: guarde com cuidado e apague depois de importar.
 */
import { existsSync, writeFileSync } from "node:fs";

interface Consulta {
  query<T = any>(sql: string): Promise<{ rows: T[] }>;
  fechar(): Promise<void>;
}

function argumento(nome: string) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function abrir(): Promise<Consulta> {
  const url = argumento("banco");
  const pasta = argumento("pasta");
  if (url) {
    const pg = (await import("pg")).default;
    const remoto = !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
    const c = new pg.Client({
      connectionString: url,
      ssl: remoto && !/sslmode=disable/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
    await c.connect();
    return { query: (s) => c.query(s) as any, fechar: () => c.end() };
  }
  if (pasta) {
    if (!existsSync(pasta)) throw new Error(`Pasta não encontrada: ${pasta}`);
    const { PGlite } = await import("@electric-sql/pglite");
    const db = await PGlite.create({ dataDir: pasta });
    return { query: (s) => db.query(s) as any, fechar: () => db.close() };
  }
  throw new Error("Informe --banco <DATABASE_URL do Cronogramas> ou --pasta <pasta dos dados do Cronogramas>.");
}

async function exportar() {
  const db = await abrir();
  try {
    const { rows } = await db.query<{ s: string | null }>(
      "SELECT CASE WHEN to_regclass('cronogramas.usuarios') IS NOT NULL THEN 'cronogramas' WHEN to_regclass('public.usuarios') IS NOT NULL THEN 'public' END AS s",
    );
    const schema = rows[0]?.s;
    if (!schema) throw new Error("Não achei as tabelas do Cronogramas (usuarios) nem em cronogramas nem em public.");
    const versao = await db
      .query<{ nome: string }>(`SELECT nome FROM ${schema}.migracoes ORDER BY nome DESC LIMIT 1`)
      .then((r) => r.rows[0]?.nome ?? null)
      .catch(() => null);
    const clientes = (await db.query(`SELECT id, nome, cnpj AS documento, ativo FROM ${schema}.clientes ORDER BY nome`))
      .rows;
    const perfis = (await db.query(`SELECT id, nome, descricao, permissoes FROM ${schema}.perfis ORDER BY nome`)).rows;
    const usuarios = (
      await db.query(
        `SELECT id, nome, email, tipo::text AS tipo, cliente_id, ativo, administrador, perfil_id, senha_hash,
                precisa_trocar_senha
           FROM ${schema}.usuarios ORDER BY nome`,
      )
    ).rows;
    const dados = {
      origem: "cronogramas",
      versao: versao ? `schema ${schema}, última migração ${versao}` : `schema ${schema}`,
      exportado_em: new Date().toISOString(),
      clientes,
      perfis,
      usuarios,
    };
    const saida = argumento("saida") ?? `exportacao-cronogramas-${new Date().toISOString().slice(0, 10)}.json`;
    writeFileSync(saida, JSON.stringify(dados, null, 2));
    console.log(
      `\n  Exportado: ${clientes.length} clientes, ${perfis.length} perfis e ${usuarios.length} usuários (schema ${schema}).` +
        `\n  Arquivo: ${saida}\n  Ele traz o hash das senhas: importe no portal e apague o arquivo.\n`,
    );
  } finally {
    await db.fechar();
  }
}

exportar().catch((e) => {
  console.error(`\n  Erro: ${e?.message ?? e}\n`);
  process.exit(1);
});
