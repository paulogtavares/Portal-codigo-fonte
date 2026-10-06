/** Cliente da API do portal (kit) e os tipos das rotas próprias. */
import { criarClienteApi } from "plataforma-kit/web";

export const EVENTO_SESSAO_EXPIRADA = "portal:sessao-expirada";

export const cliente = criarClienteApi({
  aoExpirarSessao: () => window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA)),
});

export interface ItemMenu {
  id: string;
  rotulo: string;
  caminho: string;
}
export interface ModuloMenu {
  id: string;
  nome: string;
  prefixo: string;
  noAr: boolean;
  itens: ItemMenu[];
}

export interface SaudeModulo {
  ok: boolean;
  status?: number;
  ms?: number;
  erro?: string;
  verificadoEm: string;
}
export interface SituacaoModulo {
  id: string;
  nome: string;
  url?: string;
  prefixo: string;
  origemPrefixo: "variavel" | "manifesto" | "padrao";
  versao: string | null;
  autenticacao: string | null;
  fonteManifesto: "ao-vivo" | "guardado" | null;
  manifestoLidoEm: string | null;
  erroManifesto: string | null;
  avisos: string[];
  permissoes: number;
  saude: SaudeModulo | null;
}
export interface SituacaoModulos {
  ultimaAtualizacao: string | null;
  catalogo: { novas: string[]; removidas: string[] };
  modulos: SituacaoModulo[];
}

export interface ClienteRef {
  id: string;
  nome: string;
  documento: string | null;
  ativo: boolean;
  usuarios: number;
}

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
  };
  avisos: string[];
}
