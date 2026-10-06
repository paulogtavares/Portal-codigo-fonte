/** Identidade (etapa 1): SQL do kit no schema portal, login, primeiro administrador e modo de teste. */
import { describe, expect, it } from "vitest";
import { descreverIdentidade, scriptIdentidade } from "plataforma-kit/identidade";
import { abrirEmbutido } from "../src/banco.ts";
import { bancoNovo, entrar, montarPortal } from "./apoio.ts";

/** O SQL do kit aplicado puro, no mesmo motor do teste (PGlite e PostgreSQL 16 descrevem restrições diferente). */
async function bancoReferencia() {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) {
    const r = await abrirEmbutido();
    await r.motor.exec(scriptIdentidade().sql);
    return r;
  }
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: url, options: "-c search_path=ref_kit,public", max: 1 });
  await pool.query("DROP SCHEMA IF EXISTS ref_kit CASCADE; CREATE SCHEMA ref_kit");
  await pool.query(scriptIdentidade().sql);
  return { query: (sql: string, p?: unknown[]) => pool.query(sql, p as any[]) as any, fechar: () => pool.end() };
}

describe("identidade", () => {
  it("tabelas de identidade idênticas às do kit, tudo no schema portal e nada em public", async () => {
    const p = await montarPortal();
    const ref = await bancoReferencia();
    const portal = await descreverIdentidade(p.banco);
    const kit = await descreverIdentidade(ref);
    // a única diferença é a chave própria do portal (usuarios.cliente_id → clientes)
    const { "usuarios.fk_usuarios_cliente": fk, ...restricoes } = portal.restricoes;
    expect(fk).toMatch(/REFERENCES clientes\(id\) ON DELETE SET NULL/);
    expect({ ...portal, restricoes }).toEqual(kit);
    const publicas = await p.banco.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(publicas.rows).toEqual([]);
    const migracoes = await p.banco.query("SELECT nome FROM portal.migracoes ORDER BY nome");
    expect(migracoes.rows.map((r) => r.nome)).toEqual(["01_estrutura.sql", "plataforma-kit/identidade.sql"]);
    await p.app.close();
    await ref.fechar();
  });

  it("reiniciar não reaplica nada", async () => {
    const banco = await bancoNovo();
    const p1 = await montarPortal({ banco });
    await p1.app.close();
    const p2 = await montarPortal({ banco });
    expect(p2.logs.some((l) => l.startsWith("Banco:"))).toBe(false);
    await p2.app.close();
  });

  it("login com cookie portal_sessao HttpOnly", async () => {
    const p = await montarPortal();
    const r = await p.app.inject({
      method: "POST",
      url: "/api/auth/entrar",
      payload: { email: "admin@portal.teste", senha: "teste123" },
    });
    expect(r.statusCode).toBe(200);
    expect(String(r.headers["set-cookie"])).toMatch(/^portal_sessao=.+HttpOnly; SameSite=Lax/);
    const status = (await p.app.inject({ url: "/api/status" })).json();
    expect(status).toMatchObject({ autenticacao: "local", modo_teste: true, ambiente: "local" });
    await p.app.close();
  });

  it("primeiro administrador por ADMIN_EMAIL/ADMIN_SENHA, com troca de senha; sem usuários de teste", async () => {
    const p = await montarPortal({
      env: { MODO_TESTE: undefined, ADMIN_EMAIL: "Paulo@Infracommerce.com.br", ADMIN_SENHA: "Inicial#2026x" },
    });
    const c = await entrar(p.app, "paulo@infracommerce.com.br", "Inicial#2026x");
    const eu = (await p.app.inject({ url: "/api/eu", headers: { cookie: c } })).json();
    expect(eu).toMatchObject({ administrador: true, precisa_trocar_senha: true });
    const bloqueado = await p.app.inject({ url: "/api/portal/menu", headers: { cookie: c } });
    expect(bloqueado.statusCode).toBe(403);
    await expect(entrar(p.app, "admin@portal.teste")).rejects.toThrow(/401/);
    await p.app.close();
  });

  it("MODO_TESTE ignorado em nuvem e AUTH_MODO=portal ignorado (o portal sempre faz o login)", async () => {
    const p = await montarPortal({
      env: { NODE_ENV: "production", AUTH_MODO: "portal", ADMIN_EMAIL: "a@b.com", ADMIN_SENHA: "Senha#Forte123" },
    });
    expect(p.amb.modoTeste).toBe(false);
    expect(p.sessao.modo).toBe("local");
    expect(p.logs.some((l) => l.includes("MODO_TESTE=1 IGNORADO"))).toBe(true);
    expect(p.logs.some((l) => l.includes("AUTH_MODO=portal ignorado"))).toBe(true);
    await p.app.close();
  });
});
