/** Tema do portal (claro, escuro ou do sistema): preferência visual no navegador, repassada aos módulos. */
import { aplicarTema, type Tema } from "plataforma-kit/web";

const CHAVE = "portal_tema";
export const EVENTO_TEMA = "portal:tema";

export function lerTema(): Tema {
  try {
    const t = localStorage.getItem(CHAVE);
    return t === "claro" || t === "escuro" ? t : "sistema";
  } catch {
    return "sistema";
  }
}

export function mudarTema(t: Tema) {
  try {
    localStorage.setItem(CHAVE, t);
  } catch {
    /* navegador sem armazenamento: vale só nesta aba */
  }
  aplicarTema(t);
  window.dispatchEvent(new CustomEvent<Tema>(EVENTO_TEMA, { detail: t }));
}
