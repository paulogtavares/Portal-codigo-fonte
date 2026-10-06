/**
 * Importação dos usuários do Cronogramas (Plano 4, etapa 5).
 *
 * Entrada: o JSON da exportação (ferramenta exportar-cronogramas, ou a exportação nativa do Cronogramas v2.2.0),
 * com clientes, perfis e usuários. Regras:
 *  - ids mantidos (clientes, perfis e usuários): o Cronogramas identifica a réplica local pelo sub do token, e os
 *    usuários externos apontam para os clientes pelo id;
 *  - perfis do Cronogramas viram perfis do portal: chaves com o prefixo do kit (prefixar), "portal.interno" quando o
 *    perfil tem "cronogramas.visao.interna" ou é usado por alguém interno, e "cronogramas.ver" (quando existir no
 *    catálogo) só nos perfis internos — perfil de cliente nasce sem nenhum módulo (decisão de 06/10/2026); numa
 *    reimportação, as permissões de outros módulos
 *    que o portal já tinha dado ao perfil ficam;
 *  - senha: o hash do Cronogramas vale no portal (mesmo kit, mesmo formato), mas só entra para quem ainda não tem
 *    senha no portal — reimportar nunca desfaz uma troca de senha feita no portal;
 *  - e-mail já usado no portal por outro id: com "reconciliar por e-mail", o usuário do portal passa a ter o id do
 *    Cronogramas (as sessões abertas acompanham); sem isso, é um conflito e fica de fora.
 * A simulação roda exatamente a mesma importação numa transação desfeita no fim: a prévia é o resultado real.
 */
import { z } from "zod";
import { prefixar } from "plataforma-kit/permissoes";
import { conferirSenha } from "plataforma-kit/seguranca";
import type { Banco, BancoComTransacao } from "plataforma-kit/tipos";
import { PERMISSAO_INTERNA } from "./permissoes.ts";

const uuid = z.string().uuid();
const CHAVE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
export const PERMISSAO_VISAO_INTERNA_CRONOGRAMAS = "cronogramas.visao.interna";
export const PERMISSAO_ACESSO_CRONOGRAMAS = "cronogramas.ver";

/** Contas de teste do Cronogramas (MODO_TESTE e 04_usuarios_dev.sql), todas com a senha conhecida. */
export const EMAILS_TESTE_CRONOGRAMAS = [
  "ana.souza@exemplo.com.br",
  "bruno.lima@exemplo.com.br",
  "carla@lume.exemplo.com.br",
  "marina.costa@exemplo.com.br",
] as const;
const SENHA_TESTE_CRONOGRAMAS = "teste123";

export const esquemaExportacao = z.object({
  origem: z.literal("cronogramas", { errorMap: () => ({ message: "O arquivo não é uma exportação do Cronogramas." }) }),
  versao: z.string().nullish(),
  exportado_em: z.string().nullish(),
  clientes: z
    .array(
      z.object({
        id: uuid,
        nome: z.string().trim().min(1),
        documento: z.string().nullish(),
        ativo: z.boolean().default(true),
      }),
    )
    .default([]),
  perfis: z
    .array(
      z.object({
        id: uuid,
        nome: z.string().trim().min(1).max(60),
        descricao: z.string().nullish(),
        permissoes: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  usuarios: z.array(
    z.object({
      id: uuid,
      nome: z.string().trim().min(1),
      email: z.string().trim().toLowerCase().email(),
      tipo: z.enum(["interno", "externo"]),
      cliente_id: uuid.nullish(),
      ativo: z.boolean().default(true),
      administrador: z.boolean().default(false),
      perfil_id: uuid.nullish(),
      senha_hash: z.string().nullish(),
      precisa_trocar_senha: z.boolean().default(true),
    }),
  ),
});
export type Exportacao = z.infer<typeof esquemaExportacao>;

export interface ResumoImportacao {
  simulacao: boolean;
  clientes: { criados: number; atualizados: number };
  perfis: { criados: string[]; atualizados: string[]; renomeados: { de: string; para: string }[] };
  usuarios: {
    criados: number;
    atualizados: number;
    reconciliados: { email: string; idAnterior: string; idNovo: string }[];
    conflitos: { email: string; motivo: string }[];
    comSenhaDoCronogramas: number;
    semSenha: string[];
    /** contas de teste do Cronogramas (e-mail de teste ou senha teste123); em produção entram inativas e sem senha */
    contasTeste: { email: string; motivo: string; bloqueada: boolean }[];
  };
  avisos: string[];
}

export interface OpcoesImportacao {
  simular: boolean;
  reconciliarPorEmail: boolean;
  /** quem está importando (auditoria; nunca perde o próprio acesso de administrador) */
  usuarioId: string;
  /** chaves do catálogo do Cronogramas conhecidas pelo portal (para saber se cronogramas.ver existe) */
  catalogoCronogramas: readonly string[];
  /** em produção: contas de teste entram inativas, sem senha e sem administrador */
  bloquearContasDeTeste?: boolean;
}

class Desfazer extends Error {}

/** Converte as permissões de um perfil do Cronogramas para o portal. */
export function converterPermissoes(lista: readonly string[], interno: boolean, catalogo: readonly string[]) {
  const s = new Set<string>();
  for (const p of lista) {
    const k = prefixar("cronogramas", p.trim());
    if (CHAVE.test(k)) s.add(k);
  }
  if (interno || s.has(PERMISSAO_VISAO_INTERNA_CRONOGRAMAS)) s.add(PERMISSAO_INTERNA);
  // acesso ao módulo só para a equipe interna: perfil de cliente nasce sem nenhum módulo (decisão de 06/10/2026);
  // o acesso do cliente é marcado depois, pelo administrador, e cada cronograma é liberado um a um no Cronogramas
  if (s.has(PERMISSAO_INTERNA) && catalogo.includes(PERMISSAO_ACESSO_CRONOGRAMAS)) s.add(PERMISSAO_ACESSO_CRONOGRAMAS);
  return [...s];
}

export async function importarCronogramas(banco: BancoComTransacao, dados: Exportacao, o: OpcoesImportacao) {
  const resumo: ResumoImportacao = {
    simulacao: o.simular,
    clientes: { criados: 0, atualizados: 0 },
    perfis: { criados: [], atualizados: [], renomeados: [] },
    usuarios: {
      criados: 0,
      atualizados: 0,
      reconciliados: [],
      conflitos: [],
      comSenhaDoCronogramas: 0,
      semSenha: [],
      contasTeste: [],
    },
    avisos: [],
  };
  const perfisDeCliente = dados.perfis.filter(
    (p) =>
      !converterPermissoes(p.permissoes, false, []).includes(PERMISSAO_INTERNA) &&
      !dados.usuarios.some((u) => u.perfil_id === p.id && u.tipo === "interno"),
  );
  if (perfisDeCliente.length)
    resumo.avisos.push(
      `Perfis de cliente entram sem acesso a nenhum módulo (${perfisDeCliente.map((p) => p.nome).join(", ")}): o administrador marca o acesso de cada cliente, e cada cronograma é liberado um a um no Cronogramas.`,
    );
  const emails = new Map<string, number>();
  for (const u of dados.usuarios) emails.set(u.email, (emails.get(u.email) ?? 0) + 1);
  for (const [e, n] of emails) if (n > 1) resumo.avisos.push(`E-mail repetido na exportação (${n}×): ${e}.`);

  try {
    await banco.tx(o.usuarioId, async (c) => {
      await importarClientes(c, dados, resumo);
      const idsPerfis = await importarPerfis(c, dados, o, resumo);
      await importarUsuarios(c, dados, o, resumo, idsPerfis);
      if (!o.simular)
        await c.query("INSERT INTO importacoes (origem, resumo, feita_por) VALUES ('cronogramas', $1, $2)", [
          JSON.stringify(resumo),
          (await idAtual(c, o.usuarioId, resumo)) ?? null,
        ]);
      if (o.simular) throw new Desfazer();
    });
  } catch (e) {
    if (!(e instanceof Desfazer)) throw e;
  }
  return resumo;
}

/** O operador pode ter sido reconciliado durante a importação (id novo). */
async function idAtual(c: Banco, id: string, r: ResumoImportacao) {
  const novo = r.usuarios.reconciliados.find((x) => x.idAnterior === id)?.idNovo ?? id;
  const { rows } = await c.query("SELECT 1 FROM usuarios WHERE id = $1", [novo]);
  return rows[0] ? novo : null;
}

async function importarClientes(c: Banco, d: Exportacao, r: ResumoImportacao) {
  for (const cl of d.clientes) {
    const { rows } = await c.query<{ criado: boolean }>(
      `INSERT INTO clientes (id, nome, documento, ativo, origem) VALUES ($1, $2, $3, $4, 'cronogramas')
       ON CONFLICT (id) DO UPDATE SET nome = excluded.nome, documento = excluded.documento, ativo = excluded.ativo
       RETURNING (xmax = 0) AS criado`,
      [cl.id, cl.nome, cl.documento?.trim() || null, cl.ativo],
    );
    if (rows[0].criado) r.clientes.criados++;
    else r.clientes.atualizados++;
  }
}

async function nomeLivre(c: Banco, nome: string, id: string) {
  const ocupado = async (n: string) =>
    (await c.query("SELECT 1 FROM perfis WHERE lower(nome) = lower($1) AND id <> $2", [n, id])).rows.length > 0;
  if (!(await ocupado(nome))) return nome;
  for (let i = 1; i < 100; i++) {
    const candidato = `${nome} (Cronogramas${i > 1 ? ` ${i}` : ""})`.slice(0, 60);
    if (!(await ocupado(candidato))) return candidato;
  }
  throw new Error(`Não foi possível achar um nome livre para o perfil "${nome}".`);
}

async function importarPerfis(c: Banco, d: Exportacao, o: OpcoesImportacao, r: ResumoImportacao) {
  const usadosPorInterno = new Set(
    d.usuarios.filter((u) => u.tipo === "interno" && u.perfil_id).map((u) => u.perfil_id),
  );
  const ids = new Set<string>();
  for (const p of d.perfis) {
    ids.add(p.id);
    const convertidas = converterPermissoes(p.permissoes, usadosPorInterno.has(p.id), o.catalogoCronogramas);
    const atual = await c.query<{ nome: string; permissoes: string[] }>(
      "SELECT nome, permissoes FROM perfis WHERE id = $1",
      [p.id],
    );
    if (atual.rows[0]) {
      // fica o que o portal deu ao perfil em outros módulos; o que é do Cronogramas vem da exportação
      const outras = atual.rows[0].permissoes.filter((k) => !k.startsWith("cronogramas.") && k !== PERMISSAO_INTERNA);
      const interna = atual.rows[0].permissoes.includes(PERMISSAO_INTERNA) ? [PERMISSAO_INTERNA] : [];
      await c.query("UPDATE perfis SET permissoes = $2 WHERE id = $1", [
        p.id,
        [...new Set([...convertidas, ...interna, ...outras])],
      ]);
      r.perfis.atualizados.push(atual.rows[0].nome);
    } else {
      const nome = await nomeLivre(c, p.nome, p.id);
      if (nome !== p.nome) r.perfis.renomeados.push({ de: p.nome, para: nome });
      await c.query("INSERT INTO perfis (id, nome, descricao, permissoes) VALUES ($1, $2, $3, $4)", [
        p.id,
        nome,
        p.descricao?.trim() || null,
        convertidas,
      ]);
      r.perfis.criados.push(nome);
    }
  }
  return ids;
}

interface Existente {
  id: string;
  email: string;
  administrador: boolean;
  senha_hash: string | null;
}

/** O usuário do portal com este e-mail passa a ter o id do Cronogramas (as sessões vão junto). */
async function trocarId(c: Banco, de: string, para: string) {
  await c.query("UPDATE usuarios SET email = email || '#reconciliando' WHERE id = $1", [de]);
  await c.query(
    `INSERT INTO usuarios (id, nome, email, tipo, cliente_id, ativo, administrador, perfil_id, senha_hash,
                           precisa_trocar_senha, ultimo_acesso, criado_em)
     SELECT $2, nome, replace(email, '#reconciliando', ''), tipo, cliente_id, ativo, administrador, perfil_id,
            senha_hash, precisa_trocar_senha, ultimo_acesso, criado_em
       FROM usuarios WHERE id = $1`,
    [de, para],
  );
  await c.query("UPDATE sessoes SET usuario_id = $2 WHERE usuario_id = $1", [de, para]);
  await c.query("UPDATE importacoes SET feita_por = $2 WHERE feita_por = $1", [de, para]);
  await c.query("DELETE FROM usuarios WHERE id = $1", [de]);
}

async function importarUsuarios(
  c: Banco,
  d: Exportacao,
  o: OpcoesImportacao,
  r: ResumoImportacao,
  idsPerfis: Set<string>,
) {
  const clientes = new Set((await c.query<{ id: string }>("SELECT id FROM clientes")).rows.map((x) => x.id));
  const vistos = new Set<string>();
  for (let u of d.usuarios) {
    if (vistos.has(u.email)) {
      r.usuarios.conflitos.push({ email: u.email, motivo: "e-mail repetido na exportação (só o primeiro entrou)" });
      continue;
    }
    vistos.add(u.email);
    let clienteId = u.tipo === "externo" ? (u.cliente_id ?? null) : null;
    if (clienteId && !clientes.has(clienteId)) {
      r.avisos.push(`${u.email}: cliente ${clienteId} não veio na exportação; o usuário entrou sem cliente.`);
      clienteId = null;
    }
    let administrador = u.administrador;
    if (administrador && u.tipo !== "interno") {
      r.avisos.push(`${u.email}: administrador externo não existe no portal; entrou sem ser administrador.`);
      administrador = false;
    }
    // conta de teste do Cronogramas: e-mail da lista ou senha conhecida
    const motivoTeste = (EMAILS_TESTE_CRONOGRAMAS as readonly string[]).includes(u.email)
      ? "e-mail de teste do Cronogramas"
      : u.senha_hash && (await conferirSenha(SENHA_TESTE_CRONOGRAMAS, u.senha_hash))
        ? `senha de teste (${SENHA_TESTE_CRONOGRAMAS})`
        : null;
    if (motivoTeste) {
      r.usuarios.contasTeste.push({ email: u.email, motivo: motivoTeste, bloqueada: !!o.bloquearContasDeTeste });
      if (o.bloquearContasDeTeste) {
        u = { ...u, ativo: false, administrador: false, senha_hash: null, precisa_trocar_senha: true };
        administrador = false;
      }
    }
    const perfilId = u.perfil_id && idsPerfis.has(u.perfil_id) ? u.perfil_id : null;
    if (u.perfil_id && !perfilId) r.avisos.push(`${u.email}: perfil ${u.perfil_id} não veio na exportação.`);

    const porId = (
      await c.query<Existente>("SELECT id, email, administrador, senha_hash FROM usuarios WHERE id = $1", [u.id])
    ).rows[0];
    const porEmail = (
      await c.query<Existente>("SELECT id, email, administrador, senha_hash FROM usuarios WHERE lower(email) = $1", [
        u.email,
      ])
    ).rows[0];

    let existente: Existente | undefined = porId;
    if (porEmail && porEmail.id !== u.id) {
      if (porId) {
        r.usuarios.conflitos.push({
          email: u.email,
          motivo: `o e-mail já é de outro usuário do portal e o id ${u.id} também já existe (com ${porId.email})`,
        });
        continue;
      }
      if (!o.reconciliarPorEmail) {
        r.usuarios.conflitos.push({
          email: u.email,
          motivo: 'o e-mail já existe no portal com outro id (marque "reconciliar por e-mail" para unir)',
        });
        continue;
      }
      await trocarId(c, porEmail.id, u.id);
      r.usuarios.reconciliados.push({ email: u.email, idAnterior: porEmail.id, idNovo: u.id });
      existente = { ...porEmail, id: u.id };
    }

    if (existente) {
      // quem importa nunca perde o próprio acesso de administrador
      const proprio =
        existente.id === o.usuarioId ||
        r.usuarios.reconciliados.some((x) => x.idAnterior === o.usuarioId && x.idNovo === existente!.id);
      const admin = administrador || (proprio && existente.administrador);
      const usarSenha = !existente.senha_hash && !!u.senha_hash;
      await c.query(
        `UPDATE usuarios SET nome = $2, email = $3, tipo = $4::tipo_usuario, cliente_id = $5, ativo = $6 OR $10,
                administrador = $7, perfil_id = $8,
                senha_hash = CASE WHEN $9::text IS NOT NULL THEN $9 ELSE senha_hash END,
                precisa_trocar_senha = CASE WHEN $9::text IS NOT NULL THEN $11 ELSE precisa_trocar_senha END
          WHERE id = $1`,
        [
          existente.id,
          u.nome,
          u.email,
          admin ? "interno" : u.tipo,
          admin ? null : clienteId,
          u.ativo,
          admin,
          perfilId,
          usarSenha ? u.senha_hash : null,
          proprio,
          u.precisa_trocar_senha,
        ],
      );
      if (usarSenha) r.usuarios.comSenhaDoCronogramas++;
      if (!usarSenha && !existente.senha_hash) r.usuarios.semSenha.push(u.email);
      r.usuarios.atualizados++;
    } else {
      await c.query(
        `INSERT INTO usuarios (id, nome, email, tipo, cliente_id, ativo, administrador, perfil_id, senha_hash,
                               precisa_trocar_senha)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          u.id,
          u.nome,
          u.email,
          u.tipo,
          clienteId,
          u.ativo,
          administrador,
          perfilId,
          u.senha_hash || null,
          u.senha_hash ? u.precisa_trocar_senha : true,
        ],
      );
      if (u.senha_hash) r.usuarios.comSenhaDoCronogramas++;
      else r.usuarios.semSenha.push(u.email);
      r.usuarios.criados++;
    }
  }
  const testes = r.usuarios.contasTeste;
  if (testes.length)
    r.avisos.push(
      o.bloquearContasDeTeste
        ? `${testes.length} conta(s) de teste do Cronogramas entraram inativas e sem senha (produção): ${testes.map((t) => t.email).join(", ")}.`
        : `${testes.length} conta(s) de teste do Cronogramas (senha conhecida): ${testes.map((t) => t.email).join(", ")}. Em produção elas entram inativas e sem senha.`,
    );
}
