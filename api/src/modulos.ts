/**
 * Registro de módulos do portal.
 *  - Quem são: variável MODULOS (id e endereço interno de cada um; prefixo opcional).
 *  - O que oferecem: o /modulo.json de cada um (menu, versão, modo de login e catálogo de permissões), lido pelo
 *    lerCatalogoAgregado do kit. O último manifesto lido fica em portal.modulos: um módulo fora do ar continua no
 *    menu e no catálogo com o que se sabia dele.
 *  - Como estão: /api/saude de cada um (situação e tempo de resposta).
 */
import { lerCatalogoAgregado, type ItemCatalogoModulo, type ModuloLido } from "plataforma-kit/catalogo";
import { normalizarPrefixo } from "plataforma-kit/servidor";
import type { Banco } from "plataforma-kit/tipos";
import { catalogo as catalogoPortal, MODULO, NOME_PORTAL } from "./permissoes.ts";

export interface ModuloConfig {
  id: string;
  /** endereço interno, ex.: http://cronogramas.railway.internal:8080 */
  url: string;
  /** prefixo fixado na variável (senão vale o do manifesto, senão /<id>) */
  prefixo?: string;
}

const ID = /^[a-z][a-z0-9_]*$/;
/** primeiros segmentos usados pelas telas e pela API do próprio portal */
const RESERVADOS = new Set(["api", "m", "admin", "assets"]);

/** "/financeiro/orcamentos/" -> "/financeiro/orcamentos"; inválido ou reservado -> null */
export function prefixoValido(valor: string | undefined | null): string | null {
  if (!valor) return null;
  const n = normalizarPrefixo(valor);
  if (n === "/") return null;
  const semBarra = n.slice(0, -1);
  if (RESERVADOS.has(semBarra.split("/")[1])) return null;
  return semBarra;
}

/**
 * Lê MODULOS: itens separados por vírgula, ponto e vírgula ou quebra de linha, cada um "id=url" ou
 * "id@/prefixo=url". Ex.: "cronogramas=http://127.0.0.1:3232, orcamentos@/financeiro/orcamentos=http://127.0.0.1:3333"
 */
export function lerRegistro(texto: string | undefined): ModuloConfig[] {
  const lista: ModuloConfig[] = [];
  for (const bruto of (texto ?? "").split(/[,;\n]/)) {
    const item = bruto.trim();
    if (!item) continue;
    const i = item.indexOf("=");
    if (i < 1) throw new Error(`MODULOS: "${item}" fora do formato id=url (ou id@/prefixo=url).`);
    const [id, prefixoBruto] = item.slice(0, i).trim().split("@");
    const url = item.slice(i + 1).trim();
    if (!ID.test(id)) throw new Error(`MODULOS: id de módulo inválido "${id}" (minúsculas, números e _).`);
    if (id === MODULO) throw new Error(`MODULOS: "${MODULO}" é o id do próprio portal.`);
    let endereco: URL;
    try {
      endereco = new URL(url);
    } catch {
      throw new Error(`MODULOS: endereço inválido para ${id}: "${url}".`);
    }
    if (endereco.protocol !== "http:" && endereco.protocol !== "https:")
      throw new Error(`MODULOS: o endereço de ${id} precisa começar com http:// ou https://.`);
    let prefixo: string | undefined;
    if (prefixoBruto !== undefined) {
      const p = prefixoValido(prefixoBruto);
      if (!p) throw new Error(`MODULOS: prefixo inválido ou reservado para ${id}: "${prefixoBruto}".`);
      prefixo = p;
    }
    if (lista.some((m) => m.id === id)) throw new Error(`MODULOS: ${id} aparece duas vezes.`);
    lista.push({ id, url: endereco.toString().replace(/\/+$/, ""), prefixo });
  }
  return lista;
}

export interface Saude {
  ok: boolean;
  status?: number;
  ms?: number;
  erro?: string;
  verificadoEm: string;
}

export interface EstadoModulo {
  id: string;
  url: string;
  /** prefixo em uso no portal, sem a barra final (ex.: "/cronogramas") */
  prefixo: string;
  /** de onde veio o prefixo */
  origemPrefixo: "variavel" | "manifesto" | "padrao";
  /** manifesto lido agora ou, com o módulo fora do ar, o último guardado */
  manifesto: ModuloLido | null;
  fonteManifesto: "ao-vivo" | "guardado" | null;
  manifestoLidoEm: string | null;
  /** por que a leitura de agora falhou (o manifesto guardado pode estar em uso) */
  erroManifesto?: string;
  saude: Saude | null;
}

export interface OpcoesRegistro {
  banco: Banco;
  modulos: ModuloConfig[];
  fetch?: typeof globalThis.fetch;
  /** tempo máximo por leitura (padrão 4 s) */
  tempoLimiteMs?: number;
  log?: (m: string) => void;
}

/** Item do catálogo oferecido na tela de perfis (as do portal e as de cada módulo, com o módulo de origem). */
export type ItemCatalogoPortal = ItemCatalogoModulo;

export function criarRegistro(o: OpcoesRegistro) {
  const buscar = o.fetch ?? globalThis.fetch;
  const log = o.log ?? (() => {});
  const tempo = o.tempoLimiteMs ?? 4000;
  const estados = new Map<string, EstadoModulo>(
    o.modulos.map((m) => [
      m.id,
      {
        id: m.id,
        url: m.url,
        prefixo: m.prefixo ?? `/${m.id}`,
        origemPrefixo: m.prefixo ? "variavel" : "padrao",
        manifesto: null,
        fonteManifesto: null,
        manifestoLidoEm: null,
        saude: null,
      },
    ]),
  );
  let emAndamento: Promise<void> | null = null;
  let relogio: ReturnType<typeof setTimeout> | null = null;
  let ultimaAtualizacao: string | null = null;

  /** Interpreta um manifesto (vivo ou guardado) com as mesmas regras do kit. */
  async function interpretar(m: ModuloConfig, bruto: unknown) {
    const r = await lerCatalogoAgregado([{ id: m.id, url: "http://guardado" }], {
      fetch: (async () => new Response(JSON.stringify(bruto), { status: 200 })) as typeof fetch,
    });
    return r.modulos[0];
  }

  function aplicarPrefixo(e: EstadoModulo, m: ModuloConfig) {
    if (m.prefixo) return;
    const doManifesto = prefixoValido(e.manifesto?.prefixo);
    if (e.manifesto?.prefixo && !doManifesto)
      log(`AVISO: ${m.id}: prefixo do manifesto "${e.manifesto.prefixo}" inválido ou reservado; usando /${m.id}.`);
    e.prefixo = doManifesto ?? `/${m.id}`;
    e.origemPrefixo = doManifesto ? "manifesto" : "padrao";
  }

  /** Carrega os manifestos guardados (antes da primeira leitura, para o portal subir mesmo com módulos fora do ar). */
  async function carregarGuardados() {
    if (!o.modulos.length) return;
    const { rows } = await o.banco.query<{ id: string; manifesto: unknown; lido_em: Date | string }>(
      "SELECT id, manifesto, lido_em FROM modulos WHERE id = ANY($1::text[])",
      [o.modulos.map((m) => m.id)],
    );
    for (const r of rows) {
      const m = o.modulos.find((x) => x.id === r.id)!;
      const e = estados.get(r.id)!;
      if (e.fonteManifesto === "ao-vivo") continue;
      const lido = await interpretar(m, r.manifesto);
      if (!lido.ok) continue;
      e.manifesto = lido;
      e.fonteManifesto = "guardado";
      e.manifestoLidoEm = new Date(r.lido_em).toISOString();
      aplicarPrefixo(e, m);
    }
  }

  async function lerSaude(m: ModuloConfig): Promise<Saude> {
    const inicio = performance.now();
    const controle = new AbortController();
    const t = setTimeout(() => controle.abort(), tempo);
    const verificadoEm = new Date().toISOString();
    try {
      const r = await buscar(`${m.url}/api/saude`, { signal: controle.signal });
      const ms = Math.round(performance.now() - inicio);
      const corpo: any = await r.json().catch(() => null);
      if (r.ok && corpo?.ok === true) return { ok: true, status: r.status, ms, verificadoEm };
      return { ok: false, status: r.status, ms, erro: `/api/saude respondeu ${r.status}`, verificadoEm };
    } catch (e: any) {
      return {
        ok: false,
        erro:
          e?.name === "AbortError" ? "sem resposta no tempo limite" : `sem conexão (${e?.cause?.code ?? e?.message})`,
        verificadoEm,
      };
    } finally {
      clearTimeout(t);
    }
  }

  async function atualizarAgora() {
    // guarda o JSON bruto de cada manifesto lido com sucesso, para salvar no banco
    const brutos = new Map<string, unknown>();
    const buscarGuardando = (async (url: string | URL | Request, init?: RequestInit) => {
      const r = await buscar(url as any, init);
      if (!r.ok) return r;
      const texto = await r.text();
      try {
        brutos.set(String(url), JSON.parse(texto));
      } catch {
        /* o kit relata o manifesto inválido */
      }
      return new Response(texto, { status: r.status, headers: r.headers });
    }) as typeof fetch;

    const [lidos, saudes] = await Promise.all([
      lerCatalogoAgregado(o.modulos, { fetch: buscarGuardando, tempoLimiteMs: tempo }),
      Promise.all(o.modulos.map((m) => lerSaude(m))),
    ]);
    for (const [i, m] of o.modulos.entries()) {
      const e = estados.get(m.id)!;
      const lido = lidos.modulos[i];
      e.saude = saudes[i];
      if (lido.ok) {
        for (const a of lido.avisos) log(`AVISO: ${m.id}: ${a}`);
        e.manifesto = lido;
        e.fonteManifesto = "ao-vivo";
        e.manifestoLidoEm = new Date().toISOString();
        delete e.erroManifesto;
        const bruto = brutos.get(`${m.url}/modulo.json`);
        if (bruto)
          await o.banco.query(
            `INSERT INTO modulos (id, manifesto, lido_em) VALUES ($1, $2, now())
             ON CONFLICT (id) DO UPDATE SET manifesto = excluded.manifesto, lido_em = now()`,
            [m.id, JSON.stringify(bruto)],
          );
      } else {
        if (e.fonteManifesto === "ao-vivo") e.fonteManifesto = "guardado";
        if (e.erroManifesto !== lido.erro) log(`AVISO: módulo ${m.id} (${m.url}): ${lido.erro}`);
        e.erroManifesto = lido.erro;
      }
      aplicarPrefixo(e, m);
    }
    ultimaAtualizacao = new Date().toISOString();
  }

  /** Relê manifestos e saúde de todos (uma leitura por vez; chamadas simultâneas esperam a mesma). */
  function atualizar() {
    emAndamento ??= atualizarAgora().finally(() => {
      emAndamento = null;
    });
    return emAndamento;
  }

  function lista() {
    return [...estados.values()];
  }

  /** Módulo responsável por um caminho do portal (o prefixo mais longo vence) e o caminho dentro do módulo. */
  function porCaminho(caminho: string): { estado: EstadoModulo; resto: string } | null {
    let achado: EstadoModulo | null = null;
    for (const e of estados.values()) {
      if (caminho === e.prefixo || caminho.startsWith(`${e.prefixo}/`)) {
        if (!achado || e.prefixo.length > achado.prefixo.length) achado = e;
      }
    }
    if (!achado) return null;
    return { estado: achado, resto: caminho.slice(achado.prefixo.length) || "/" };
  }

  /** Catálogo dos módulos (vivo ou guardado). */
  function catalogoModulos(): ItemCatalogoPortal[] {
    return lista().flatMap((e) => e.manifesto?.permissoes ?? []);
  }

  return {
    carregarGuardados,
    atualizar,
    lista,
    porCaminho,
    catalogoModulos,
    obter: (id: string) => estados.get(id) ?? null,
    get ultimaAtualizacao() {
      return ultimaAtualizacao;
    },
    /**
     * Relê de tempos em tempos (padrão 60 s). Enquanto algum módulo nunca respondeu (sem manifesto, nem guardado),
     * tenta a cada 10 s: assim um módulo que sobe depois do portal entra no menu e no prefixo certo logo.
     */
    iniciar(intervaloMs = 60_000) {
      if (relogio) return;
      const agendar = () => {
        const espera = lista().some((e) => !e.manifesto) ? Math.min(10_000, intervaloMs) : intervaloMs;
        relogio = setTimeout(() => {
          atualizar()
            .catch((e) => log(`AVISO: leitura dos módulos falhou: ${e?.message ?? e}`))
            .finally(() => {
              if (relogio) agendar();
            });
        }, espera);
        relogio.unref?.();
      };
      agendar();
    },
    parar() {
      if (relogio) clearTimeout(relogio);
      relogio = null;
    },
  };
}

export type Registro = ReturnType<typeof criarRegistro>;

/** Permissões do próprio portal no formato do catálogo agregado (seção "Portal" na tela de perfis). */
export const catalogoProprio = (): ItemCatalogoPortal[] =>
  catalogoPortal.lista.map((p) => ({ ...p, modulo: MODULO, moduloNome: NOME_PORTAL }));

/**
 * Catálogo usado na administração de usuários e perfis: o do portal, o dos módulos registrados (vivo ou guardado) e,
 * para não travar a edição de perfis antigos, as permissões gravadas em perfis cujo módulo não está no registro.
 */
export async function catalogoParaAdministracao(banco: Banco, registro: Registro): Promise<ItemCatalogoPortal[]> {
  const conhecidas = [...catalogoProprio(), ...registro.catalogoModulos()];
  const chaves = new Set(conhecidas.map((p) => p.chave));
  const { rows } = await banco.query<{ p: string }>("SELECT DISTINCT unnest(permissoes) AS p FROM perfis ORDER BY 1");
  const orfas: ItemCatalogoPortal[] = rows
    .map((r) => r.p)
    .filter((p) => !chaves.has(p))
    .map((p) => {
      const modulo = p.split(".")[0];
      return {
        chave: p,
        grupo: "Permissões guardadas",
        nome: p,
        descricao: "Permissão gravada em perfis de um módulo que o portal não conhece agora (fora do registro).",
        modulo,
        moduloNome: `${modulo} (fora do registro)`,
      };
    });
  return [...conhecidas, ...orfas];
}
