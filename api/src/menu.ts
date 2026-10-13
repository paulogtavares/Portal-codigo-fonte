/**
 * Menu do portal, montado dos manifestos e filtrado pelas visões do perfil (decisão de 02/10/2026):
 *  - o módulo aparece para quem tem ao menos uma permissão dele (o administrador vê todos);
 *  - cada item respeita o exigeAlguma (basta uma) e o somenteAdministrador do manifesto;
 *  - itens que o portal assume (Usuários e perfis) nunca aparecem, mesmo de módulo com kit antigo;
 *  - módulo em modo local (AUTH_MODO=local) não entra: o portal não repassa cookie, então ele não funcionaria;
 *  - submenus (filhos, kit 1.7.0) seguem as mesmas regras; um grupo sem nenhum submenu visível some.
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
  /** submenus visíveis para o usuário (kit 1.7.0); o grupo só aparece com ao menos um */
  filhos?: ItemMenuPortal[];
}

export interface ModuloMenu {
  id: string;
  nome: string;
  /** área do menu que reúne módulos (manifesto "grupo", kit 1.6.0); sem ela, o módulo aparece sozinho */
  grupo: string | null;
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

const caminhoValido = (c: unknown) => typeof c === "string" && /^\/(?![/\\])/.test(c);

export function montarMenu(estados: readonly EstadoModulo[], u: UsuarioMenu): ModuloMenu[] {
  const menu: ModuloMenu[] = [];
  for (const e of estados) {
    const m = e.manifesto;
    if (!m || m.autenticacao !== "portal" || !temVisao(u, e.id)) continue;
    const itens = m.menu
      .filter((i) => !itemSoLocal(i) && itemVisivel(u, i) && caminhoValido(i.caminho))
      .map((i): ItemMenuPortal | null => {
        const base = { id: i.id, rotulo: i.rotulo, caminho: i.caminho };
        if (!Array.isArray(i.filhos)) return base;
        const filhos = i.filhos
          .filter((f) => !itemSoLocal(f) && itemVisivel(u, f) && caminhoValido(f.caminho))
          .map((f) => ({ id: f.id, rotulo: f.rotulo, caminho: f.caminho }));
        if (!filhos.length) return null;
        // o grupo leva a um submenu que a pessoa pode abrir
        const caminho = filhos.some((f) => f.caminho === i.caminho) ? i.caminho : filhos[0].caminho;
        return { ...base, caminho, filhos };
      })
      .filter((i): i is ItemMenuPortal => i !== null);
    if (!itens.length) continue;
    menu.push({
      id: e.id,
      nome: m.nome ?? e.id,
      grupo: m.grupo ?? null,
      prefixo: e.prefixo,
      noAr: e.saude?.ok !== false,
      itens,
    });
  }
  return menu;
}
