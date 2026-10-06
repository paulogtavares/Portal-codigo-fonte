/**
 * Montagem do servidor do portal (Fastify 5 + plataforma-kit 1.5.1). Separada do servidor.ts para os testes
 * montarem o mesmo app com um banco em memória e módulos de teste.
 *
 * O portal é a porta única da plataforma: faz o login (modo local do kit, cookie portal_sessao), é dono dos usuários
 * e perfis, monta o menu a partir dos manifestos e repassa cada acesso ao módulo certo com o token da plataforma.
 */
import Fastify from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rotasAdministracao } from "plataforma-kit/administracao";
import { lerAmbiente } from "plataforma-kit/ambiente";
import { validarSegredo } from "plataforma-kit/portal";
import { gerarHashSenha } from "plataforma-kit/seguranca";
import { prepararServidor, servirFront } from "plataforma-kit/servidor";
import { criarSessao } from "plataforma-kit/sessao";
import { auditarUsuariosDeTeste } from "plataforma-kit/usuariosTeste";
import type { BancoModulo } from "./banco.ts";
import { aplicarMigracoes } from "./migracoes.ts";
import { catalogoParaAdministracao, criarRegistro, lerRegistro } from "./modulos.ts";
import { catalogo, MODULO, PERMISSAO_INTERNA } from "./permissoes.ts";
import { registrarProxy } from "./proxy.ts";
import { rotasPortal } from "./rotas/portal.ts";

export const SENHA_TESTE = "teste123";

/** Perfis e usuários de teste (só com MODO_TESTE=1, nunca em nuvem). */
export const PERFIS_TESTE = [
  {
    nome: "Projetos (teste)",
    descricao: "Time de implantação: cronogramas e consulta de orçamentos.",
    permissoes: [
      PERMISSAO_INTERNA,
      "cronogramas.criar",
      "cronogramas.ver_todos",
      "cronogramas.compartilhar",
      "cronogramas.modelos.ver",
      "cronogramas.visao.interna",
      "cronogramas.exportar.pdf",
      "orcamentos.ver",
    ],
  },
  {
    nome: "Comercial (teste)",
    descricao: "Simulações no Cronogramas; orçamentos sem custos.",
    permissoes: [
      PERMISSAO_INTERNA,
      "cronogramas.modelos.ver",
      "cronogramas.simulacoes.criar",
      "cronogramas.visao.interna",
      "cronogramas.exportar.pdf",
      "orcamentos.ver",
      "orcamentos.editar",
    ],
  },
  {
    nome: "Financeiro (teste)",
    descricao: "Orçamentos com custos e aprovação; vê a situação dos módulos.",
    permissoes: [
      PERMISSAO_INTERNA,
      "portal.modulos.ver",
      "orcamentos.ver",
      "orcamentos.editar",
      "orcamentos.aprovar",
      "orcamentos.custos.ver",
      "orcamentos.custos.gerenciar",
      "orcamentos.templates.gerenciar",
    ],
  },
] as const;

export const USUARIOS_TESTE = [
  { email: "admin@portal.teste", nome: "Admin de Teste", perfil: null, administrador: true },
  { email: "projetos@portal.teste", nome: "Projetos de Teste", perfil: "Projetos (teste)", administrador: false },
  { email: "comercial@portal.teste", nome: "Comercial de Teste", perfil: "Comercial (teste)", administrador: false },
  { email: "financeiro@portal.teste", nome: "Financeiro de Teste", perfil: "Financeiro (teste)", administrador: false },
] as const;

export interface OpcoesApp {
  banco: BancoModulo;
  env?: NodeJS.ProcessEnv;
  versao: string;
  data: string;
  /** pasta com public/ (front compilado); sem ela, só a API */
  pastaFront?: string;
  /** fetch usado para ler manifestos e saúde dos módulos (testes) */
  buscarModulos?: typeof fetch;
  /** ler os módulos de tempos em tempos (padrão: sim; os testes desligam) */
  releituraPeriodica?: boolean;
  log?: (m: string) => void;
}

const logPadrao = (m: string) => console.log(new Date().toLocaleTimeString("pt-BR"), m);

/** Arquivo da raiz: ../../ no código-fonte (api/src), ./ no pacote (ao lado do server.js). */
export function lerJsonDaRaiz(nome: string) {
  for (const u of [new URL(`../../${nome}`, import.meta.url), new URL(`./${nome}`, import.meta.url)]) {
    const caminho = fileURLToPath(u);
    if (existsSync(caminho)) return JSON.parse(readFileSync(caminho, "utf8"));
  }
  throw new Error(`${nome} não encontrado.`);
}

export function lerVersao(): { versao: string; data: string } {
  const p = lerJsonDaRaiz("package.json");
  return { versao: p.version, data: p.buildDate };
}

export async function criarApp(o: OpcoesApp) {
  const log = o.log ?? logPadrao;
  // o portal é quem faz o login: AUTH_MODO=portal não faz sentido para ele
  const env = { ...(o.env ?? process.env) };
  if (env.AUTH_MODO && env.AUTH_MODO.trim().toLowerCase() !== "local")
    log(`AVISO: AUTH_MODO=${env.AUTH_MODO} ignorado: o portal sempre faz o próprio login (a variável é dos módulos).`);
  delete env.AUTH_MODO;
  const amb = lerAmbiente({ modulo: MODULO, cookiePadrao: "portal_sessao" }, env);
  for (const a of amb.avisos) log(`AVISO: ${a}`);
  for (const e of amb.erros) log(`ERRO: ${e}`);

  // segredo que assina os tokens: obrigatório em nuvem; no computador o portal sobe sem ele, com o repasse desligado
  let segredo: string | undefined;
  try {
    segredo = validarSegredo(env.SEGREDO_PLATAFORMA);
  } catch (e: any) {
    if (amb.nuvem) throw new Error(`${e.message} Sem ele o portal não consegue falar com os módulos.`);
    log(`AVISO: ${e.message} O repasse aos módulos fica desligado até a variável ser definida.`);
  }
  const modulos = lerRegistro(env.MODULOS);
  if (!modulos.length) log("AVISO: nenhum módulo registrado (variável MODULOS).");

  const { banco } = o;
  const aplicados = await aplicarMigracoes(banco, log);
  if (aplicados.length) log(`Banco: ${aplicados.join(", ")}`);
  await prepararUsuarios(banco, env, amb, log);

  // módulos: manifestos guardados primeiro (o portal sobe mesmo com algum fora do ar), depois a leitura de agora
  const registro = criarRegistro({ banco, modulos, fetch: o.buscarModulos, log });
  await registro.carregarGuardados();
  await registro.atualizar();
  for (const e of registro.lista())
    log(
      `Módulo ${e.id}: ${e.prefixo} → ${e.url} · ${e.saude?.ok ? `no ar (${e.saude.ms} ms)` : `fora do ar (${e.saude?.erro})`}` +
        `${e.manifesto ? ` · v${e.manifesto.versao ?? "?"} · login ${e.manifesto.autenticacao}` : " · sem manifesto"}`,
    );
  if (o.releituraPeriodica !== false) registro.iniciar();

  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024, trustProxy: true });
  app.decorateRequest("usuario", null);
  app.addHook("onClose", async () => registro.parar());
  const sessao = criarSessao({
    banco,
    todasPermissoes: catalogo.todas,
    modo: "local",
    nomeCookie: amb.acesso.nomeCookie,
    modulo: MODULO,
    log,
  });

  // o repasse vem antes de tudo: caminhos dos módulos não passam pelas rotas do portal
  registrarProxy(app, { registro, sessao, segredo, log });

  await prepararServidor(app, {
    sessao,
    banco,
    producao: amb.producao,
    versao: o.versao,
    data: o.data,
    tipoBanco: () => banco.tipo,
    permissoes: catalogo.lista,
    acessoTeste: amb.modoTeste
      ? {
          senha: SENHA_TESTE,
          emails: USUARIOS_TESTE.map((u) => ({ email: u.email, perfil: u.perfil ?? "Administrador" })),
        }
      : undefined,
    restricoes: { fk_usuarios_cliente: "Cliente não encontrado." },
    log,
  });

  // usuários e perfis: telas e rotas do kit, com o catálogo de todos os módulos (perfis com visões por módulo)
  const catalogoAdmin = await catalogoParaAdministracao(banco, registro);
  await app.register(rotasAdministracao, {
    banco,
    catalogo: catalogoAdmin,
    permissaoInterna: PERMISSAO_INTERNA,
    usuarios: { colunas: "cli.nome AS cliente_nome", juncoes: "LEFT JOIN clientes cli ON cli.id = u.cliente_id" },
  });
  // catálogo dos módulos oferecido nos perfis desde o início (para avisar quando mudar; ver pedido ao kit 1.6.0)
  const catalogoInicial = new Set(registro.catalogoModulos().map((p) => p.chave));
  await app.register(rotasPortal, { banco, registro, catalogoInicial });
  servirFront(app, o.pastaFront);

  return { app, amb, registro, sessao, segredo };
}

/** Primeiro administrador (ADMIN_EMAIL/ADMIN_SENHA), perfis e usuários de teste (MODO_TESTE=1) e auditoria. */
async function prepararUsuarios(
  banco: BancoModulo,
  env: NodeJS.ProcessEnv,
  amb: ReturnType<typeof lerAmbiente>,
  log: (m: string) => void,
) {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  const senha = env.ADMIN_SENHA;
  const { rows } = await banco.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM usuarios WHERE administrador AND ativo AND senha_hash IS NOT NULL AND NOT (lower(email) = ANY($1::text[]))",
    [USUARIOS_TESTE.map((u) => u.email)],
  );
  if (rows[0].n === 0 && email && senha) {
    await banco.query(
      `INSERT INTO usuarios (nome, email, tipo, administrador, senha_hash, precisa_trocar_senha, ativo)
       VALUES ($1, $2, 'interno', true, $3, true, true)
       ON CONFLICT ((lower(email))) DO UPDATE SET administrador = true, ativo = true, tipo = 'interno', cliente_id = NULL,
         senha_hash = excluded.senha_hash, precisa_trocar_senha = true`,
      [env.ADMIN_NOME?.trim() || email.split("@")[0], email, await gerarHashSenha(senha)],
    );
    log(`Primeiro administrador: ${email} (troca de senha obrigatória no primeiro acesso).`);
  } else if (rows[0].n === 0 && !amb.modoTeste) {
    log("AVISO: nenhum administrador com senha. Defina ADMIN_EMAIL e ADMIN_SENHA e reinicie.");
  }
  if (amb.modoTeste) {
    for (const p of PERFIS_TESTE)
      await banco.query(
        "INSERT INTO perfis (nome, descricao, permissoes) VALUES ($1, $2, $3) ON CONFLICT ((lower(nome))) DO NOTHING",
        [p.nome, p.descricao, [...p.permissoes]],
      );
    const hash = await gerarHashSenha(SENHA_TESTE);
    for (const u of USUARIOS_TESTE)
      await banco.query(
        `INSERT INTO usuarios (nome, email, tipo, administrador, perfil_id, senha_hash, precisa_trocar_senha)
         VALUES ($1, $2, 'interno', $3, (SELECT id FROM perfis WHERE nome = $4), $5, false)
         ON CONFLICT ((lower(email))) DO NOTHING`,
        [u.nome, u.email, u.administrador, u.perfil, hash],
      );
    log(`MODO_TESTE=1: usuários de teste liberados (senha ${SENHA_TESTE}).`);
  } else {
    await auditarUsuariosDeTeste({
      banco,
      emails: USUARIOS_TESTE.map((u) => u.email),
      senha: SENHA_TESTE,
      producao: amb.producao,
      log,
    });
  }
}
