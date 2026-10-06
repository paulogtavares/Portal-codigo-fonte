/**
 * Catálogo de permissões do próprio portal (regra do kit: toda chave começa com "portal.").
 * As permissões dos módulos vêm dos manifestos (catálogo agregado, ver modulos.ts).
 */
import { criarCatalogo } from "plataforma-kit/permissoes";
import type { UsuarioPlataforma } from "plataforma-kit/tipos";

export const MODULO = "portal";
export const NOME_PORTAL = "Portal";

/** Perfil com esta permissão é da equipe interna; sem ela, o usuário é externo (cliente). */
export const PERMISSAO_INTERNA = "portal.interno";

export const catalogo = criarCatalogo(MODULO, [
  {
    chave: PERMISSAO_INTERNA,
    grupo: "Portal",
    nome: "Equipe interna",
    descricao:
      "Usuário da equipe Infracommerce. Sem esta permissão o usuário é externo (de um cliente) e não pode ser administrador.",
  },
  {
    chave: "portal.modulos.ver",
    grupo: "Portal",
    nome: "Ver a situação dos módulos",
    descricao: "Tela Módulos: versão, situação e modo de login de cada módulo.",
  },
] as const);

export type PermissaoPortal = (typeof catalogo.todas)[number];
export type UsuarioPortal = UsuarioPlataforma<string>;

declare module "fastify" {
  interface FastifyRequest {
    usuario: UsuarioPortal | null;
  }
}
