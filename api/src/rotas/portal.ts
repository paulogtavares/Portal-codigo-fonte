/**
 * Rotas próprias do portal (o login, /api/eu e /api/admin/* vêm do kit):
 *   GET  /api/portal/menu                      módulos e itens do menu visíveis para o usuário
 *   GET  /api/portal/modulos                   saúde dos módulos (portal.modulos.ver ou administrador)
 *   POST /api/portal/modulos/atualizar         relê manifestos e saúde agora
 *   GET  /api/portal/clientes                  clientes de referência (administrador; formulário de usuário externo)
 *   POST /api/portal/importacao/cronogramas    simula ou importa os usuários do Cronogramas (administrador)
 *   GET  /api/portal/importacoes               histórico das importações (administrador)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ErroApi, proibido } from "plataforma-kit/erros";
import { exigirAdministrador, pode } from "plataforma-kit/permissoes";
import type { BancoComTransacao } from "plataforma-kit/tipos";
import { esquemaExportacao, importarCronogramas } from "../importacao.ts";
import { montarMenu } from "../menu.ts";
import type { Registro } from "../modulos.ts";

export interface OpcoesRotasPortal {
  banco: BancoComTransacao;
  registro: Registro;
  /** em produção, a importação bloqueia as contas de teste do Cronogramas */
  producao: boolean;
}

export async function rotasPortal(app: FastifyInstance, o: OpcoesRotasPortal) {
  const { banco, registro } = o;

  app.get("/api/portal/menu", async (req) => montarMenu(registro.lista(), req.usuario!));

  const exigirVerModulos = (req: { usuario: any }) => {
    if (!pode(req.usuario, "portal.modulos.ver")) throw proibido();
  };

  function situacao(admin: boolean) {
    return {
      ultimaAtualizacao: registro.ultimaAtualizacao,
      modulos: registro.lista().map((e) => ({
        id: e.id,
        nome: e.manifesto?.nome ?? e.id,
        grupo: e.manifesto?.grupo ?? null,
        // o endereço interno da rede privada só aparece para o administrador
        ...(admin ? { url: e.url } : {}),
        prefixo: e.prefixo,
        origemPrefixo: e.origemPrefixo,
        versao: e.manifesto?.versao ?? null,
        autenticacao: e.manifesto?.autenticacao ?? null,
        fonteManifesto: e.fonteManifesto,
        manifestoLidoEm: e.manifestoLidoEm,
        erroManifesto: e.erroManifesto ?? null,
        avisos: e.manifesto?.avisos ?? [],
        permissoes: e.manifesto?.permissoes.length ?? 0,
        saude: e.saude,
      })),
    };
  }

  app.get("/api/portal/modulos", async (req) => {
    exigirVerModulos(req);
    return situacao(!!req.usuario?.administrador);
  });

  app.post("/api/portal/modulos/atualizar", async (req) => {
    exigirVerModulos(req);
    await registro.atualizar();
    return situacao(!!req.usuario?.administrador);
  });

  app.get("/api/portal/clientes", async (req) => {
    exigirAdministrador(req.usuario);
    const { rows } = await banco.query(
      `SELECT c.id, c.nome, c.documento, c.ativo, c.origem,
              (SELECT count(*)::int FROM usuarios u WHERE u.cliente_id = c.id) AS usuarios
         FROM clientes c ORDER BY c.ativo DESC, lower(c.nome)`,
    );
    return rows;
  });

  app.post("/api/portal/importacao/cronogramas", async (req) => {
    exigirAdministrador(req.usuario);
    const corpo = z
      .object({
        dados: z.unknown(),
        simular: z.boolean().default(true),
        reconciliarPorEmail: z.boolean().default(true),
      })
      .parse(req.body);
    const lido = esquemaExportacao.safeParse(corpo.dados);
    if (!lido.success) {
      const p = lido.error.issues[0];
      throw new ErroApi(
        400,
        `Arquivo de exportação inválido: ${p.message}${p.path.length ? ` (${p.path.join(".")})` : ""}.`,
      );
    }
    const catalogoCronogramas = (registro.obter("cronogramas")?.manifesto?.permissoes ?? []).map((p) => p.chave);
    return importarCronogramas(banco, lido.data, {
      simular: corpo.simular,
      reconciliarPorEmail: corpo.reconciliarPorEmail,
      usuarioId: req.usuario!.id,
      catalogoCronogramas,
      bloquearContasDeTeste: o.producao,
    });
  });

  app.get("/api/portal/importacoes", async (req) => {
    exigirAdministrador(req.usuario);
    const { rows } = await banco.query(
      `SELECT i.id, i.origem, i.resumo, i.feita_em, u.nome AS feita_por
         FROM importacoes i LEFT JOIN usuarios u ON u.id = i.feita_por ORDER BY i.feita_em DESC LIMIT 20`,
    );
    return rows;
  });
}
