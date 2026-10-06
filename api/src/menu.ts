/**
 * Menu do portal, montado dos manifestos e filtrado pelas visões do perfil (decisão de 02/10/2026):
 *  - o módulo aparece para quem tem ao menos uma permissão dele (o administrador vê todos);
 *  - cada item respeita o exigeAlguma (basta uma) e o somenteAdministrador do manifesto;
 *  - itens que o portal assume (Usuários e perfis) nunca aparecem, mesmo de módulo com kit antigo;
 *  - módulo em modo local (AUTH_MODO=local) não entra: o portal não repassa cookie, então ele não funcionaria.
 */
import { itemSoLocal } from "plataforma-kit/servidor";
import type { EstadoModulo } from "./modulos.ts";

export interface UsuarioMenu {
  administrador: boolean;
  permissoes: readonly string[];
}

export interface ItemMenuPortal {
  id: string;
  rotulo: string;
  caminho: string;
}

export interface ModuloMenu {
  id: string;
  nome: string;
  prefixo: string;
  /** false quando a última verificação de saúde falhou (o menu usa o manifesto guardado) */
  noAr: boolean;
  itens: ItemMenuPortal[];
}

/** O usuário tem acesso ao módulo (alguma permissão "<id>.…" ou administrador)? */
export function temVisao(u: UsuarioMenu, modulo: string) {
  return u.administrador || u.permissoes.some((p) => p.startsWith(`${modulo}.`));
}

function itemVisivel(u: UsuarioMenu, item: { exigeAlguma?: unknown; somenteAdministrador?: unknown }) {
  if (u.administrador) return true;
  if (item.somenteAdministrador === true) return false;
  const exige = Array.isArray(item.exigeAlguma) ? item.exigeAlguma.filter((p) => typeof p === "string") : [];
  return !exige.length || exige.some((p) => u.permissoes.includes(p));
}

export function montarMenu(estados: readonly EstadoModulo[], u: UsuarioMenu): ModuloMenu[] {
  const menu: ModuloMenu[] = [];
  for (const e of estados) {
    const m = e.manifesto;
    if (!m || m.autenticacao !== "portal" || !temVisao(u, e.id)) continue;
    const itens = m.menu
      .filter((i) => !itemSoLocal(i) && itemVisivel(u, i))
      .filter((i) => /^\/(?![/\\])/.test(i.caminho))
      .map((i) => ({ id: i.id, rotulo: i.rotulo, caminho: i.caminho }));
    if (!itens.length) continue;
    menu.push({ id: e.id, nome: m.nome ?? e.id, prefixo: e.prefixo, noAr: e.saude?.ok !== false, itens });
  }
  return menu;
}
