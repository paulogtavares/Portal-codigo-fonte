/**
 * Acesso ao banco: PostgreSQL (DATABASE_URL) ou PGlite embutido (DADOS_DIR, ou memória nos testes).
 * Toda conexão usa search_path = portal, public: as tabelas do portal ficam no schema portal e nada é criado em public.
 */
import { mkdirSync } from "node:fs";
import type { MotorMigracao } from "plataforma-kit/migrador";
import type { Banco, BancoComTransacao, Resultado } from "plataforma-kit/tipos";

export const SCHEMA = "portal";
const CAMINHO_BUSCA = `${SCHEMA}, public`;

export interface BancoModulo extends BancoComTransacao {
  motor: MotorMigracao;
  tipo: "postgres" | "embutido";
  fechar(): Promise<void>;
}

const resultado = (r: { rows: any[]; rowCount?: number | null; affectedRows?: number }): Resultado => ({
  rows: r.rows,
  rowCount: r.rowCount ?? (r.rows.length || r.affectedRows || 0),
});

/** usuário da requisição disponível no banco (auditoria), só dentro da transação */
const marcarUsuario = (q: Banco["query"], usuarioId: string | null) =>
  usuarioId ? q("SELECT set_config('app.usuario_id', $1, true)", [usuarioId]) : Promise.resolve(null);

/** PGlite: em memória (sem pasta) ou numa pasta de dados. Uma conexão só; o search_path é fixado ao abrir. */
export async function abrirEmbutido(pasta?: string): Promise<BancoModulo> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (pasta) mkdirSync(pasta, { recursive: true });
  const db = await PGlite.create(pasta ? { dataDir: pasta } : {});
  await db.exec(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}; SET search_path TO ${CAMINHO_BUSCA};`);
  const query: Banco["query"] = async (sql, params) => resultado(await db.query<any>(sql, params as any[]));
  return {
    tipo: "embutido",
    query,
    tx: (usuarioId, fn) =>
      db.transaction(async (t) => {
        const q: Banco["query"] = async (sql, params) => resultado(await t.query<any>(sql, params as any[]));
        await marcarUsuario(q, usuarioId);
        return fn({ query: q });
      }),
    motor: {
      query,
      exec: async (sql) => void (await db.exec(sql)),
      tx: (fn) =>
        db.transaction((t) =>
          fn({
            query: async (sql, params) => resultado(await t.query<any>(sql, params as any[])),
            exec: async (sql) => void (await t.exec(sql)),
          }),
        ),
    },
    fechar: () => db.close(),
  };
}

/** PostgreSQL: pool com search_path definido em cada conexão. */
export async function abrirPostgres(url: string): Promise<BancoModulo> {
  const pg = (await import("pg")).default;
  // datas (date) chegam como texto 'AAAA-MM-DD', sem conversão de fuso
  pg.types.setTypeParser(1082, (v: string) => v);
  const remoto = !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    options: `-c search_path=${CAMINHO_BUSCA.replace(" ", "")}`,
    max: 10,
    ssl:
      remoto && !/sslmode=disable/.test(url) && process.env.PGSSLMODE !== "disable"
        ? { rejectUnauthorized: false }
        : undefined,
  });
  const query: Banco["query"] = async (sql, params) => resultado(await pool.query(sql, params as any[]));
  async function emTransacao<T>(fn: (c: any) => Promise<T>) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const r = await fn(c);
      await c.query("COMMIT");
      return r;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  return {
    tipo: "postgres",
    query,
    tx: (usuarioId, fn) =>
      emTransacao(async (c) => {
        const q: Banco["query"] = async (sql, params) => resultado(await c.query(sql, params as any[]));
        await marcarUsuario(q, usuarioId);
        return fn({ query: q });
      }),
    motor: {
      query,
      exec: async (sql) => void (await pool.query(sql)),
      tx: (fn) =>
        emTransacao((c) =>
          fn({
            query: async (sql, params) => resultado(await c.query(sql, params as any[])),
            exec: async (sql) => void (await c.query(sql)),
          }),
        ),
    },
    fechar: () => pool.end(),
  };
}
