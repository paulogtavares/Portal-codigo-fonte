/**
 * Área dos módulos (Plano 4, etapa 4): um iframe por módulo, mantido aberto ao trocar de módulo ou ir à
 * administração (a tela do módulo não recarrega).
 *
 * Endereço: o portal mostra /m/<módulo><caminho do módulo>; o iframe abre <prefixo><caminho>, repassado pelo proxy.
 *  - módulo → portal "rota-alterada": o portal troca o próprio endereço (replace), sem navegar o iframe de novo;
 *    assim recarregar mantém a tela, e voltar/avançar seguem o histórico do iframe;
 *  - portal → módulo "navegar": clique no menu de um módulo já aberto (sem recarregar o iframe);
 *  - portal → módulo "tema": ao abrir o iframe e a cada troca de tema;
 *  - módulo → portal "sessao-expirada": o portal confere a própria sessão; se ela acabou, volta ao login.
 * Só são aceitas mensagens da mesma origem vindas de um dos iframes do portal; o módulo é o do iframe, nunca o
 * informado na mensagem.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { Tema } from "plataforma-kit/web";
import { useAvisos } from "plataforma-kit/react";
import { cliente, EVENTO_SESSAO_EXPIRADA, type ModuloMenu } from "../api.ts";
import { EVENTO_TEMA, lerTema } from "../tema.ts";
import { rotaDoPortal } from "./Lateral.tsx";

interface Aberto {
  id: string;
  src: string;
  /** muda para recarregar o iframe do zero */
  versao: number;
}

const enderecoNoPortal = (modulo: string, caminho: string) => `/m/${modulo}${caminho === "/" ? "" : caminho}`;

export function AreaModulos({ menu }: { menu: ModuloMenu[] }) {
  const local = useLocation();
  const nav = useNavigate();
  const { avisar, erro } = useAvisos();
  const rota = rotaDoPortal(local.pathname);
  const caminhoAtual = rota ? rota.caminho + local.search : null;
  const [abertos, setAbertos] = useState<Aberto[]>([]);
  const quadros = useRef(new Map<string, HTMLIFrameElement>());
  /** última rota informada por (ou enviada a) cada módulo */
  const rotas = useRef(new Map<string, string>());
  const renovados = useRef(new Map<string, number>());
  const atual = useRef<{ modulo: string; caminho: string } | null>(null);
  atual.current = rota && caminhoAtual ? { modulo: rota.modulo, caminho: caminhoAtual } : null;

  const enviar = useCallback((id: string, m: Record<string, unknown>) => {
    quadros.current.get(id)?.contentWindow?.postMessage(m, window.location.origin);
  }, []);

  // abrir o módulo da URL, ou levar o módulo aberto ao caminho pedido pelo portal (menu, endereço digitado)
  useEffect(() => {
    if (!rota || !caminhoAtual) return;
    const modulo = menu.find((m) => m.id === rota.modulo);
    if (!modulo) return;
    const ja = abertos.find((a) => a.id === modulo.id);
    if (!ja) {
      rotas.current.set(modulo.id, caminhoAtual);
      setAbertos((l) => [...l, { id: modulo.id, src: `${modulo.prefixo}${caminhoAtual}`, versao: 0 }]);
    } else if (rotas.current.get(modulo.id) !== caminhoAtual) {
      rotas.current.set(modulo.id, caminhoAtual);
      enviar(modulo.id, { tipo: "navegar", caminho: caminhoAtual });
    }
  }, [rota?.modulo, caminhoAtual, menu, abertos, enviar]); // eslint-disable-line react-hooks/exhaustive-deps

  // mensagens dos módulos
  useEffect(() => {
    const aoReceber = async (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const id = [...quadros.current.entries()].find(([, f]) => f.contentWindow === e.source)?.[0];
      const m = e.data;
      if (!id || !m || typeof m !== "object") return;
      if (m.tipo === "rota-alterada" && typeof m.caminho === "string" && /^\/(?![/\\])/.test(m.caminho)) {
        rotas.current.set(id, m.caminho);
        const a = atual.current;
        if (a?.modulo === id && a.caminho !== m.caminho) nav(enderecoNoPortal(id, m.caminho), { replace: true });
        if (a?.modulo === id && typeof m.titulo === "string" && m.titulo) document.title = `${m.titulo} · Portal`;
      } else if (m.tipo === "sessao-expirada") {
        // a sessão do portal acabou? então volta ao login do portal
        try {
          await cliente.get("/eu");
        } catch (x: any) {
          if (x?.status === 401) {
            window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
            return;
          }
        }
        // a sessão continua: o problema foi o acesso ao módulo; abre o módulo de novo (no máximo 1 vez a cada 30 s)
        const agora = Date.now();
        if (agora - (renovados.current.get(id) ?? 0) < 30_000) {
          erro(new Error("O módulo recusou o acesso pelo portal. Avise o administrador (confira SEGREDO_PLATAFORMA)."));
          return;
        }
        renovados.current.set(id, agora);
        setAbertos((l) => l.map((x) => (x.id === id ? { ...x, versao: x.versao + 1 } : x)));
        avisar("O acesso ao módulo foi renovado.");
      }
    };
    window.addEventListener("message", aoReceber);
    return () => window.removeEventListener("message", aoReceber);
  }, [nav, avisar, erro]);

  // tema: repassado a todos os módulos abertos
  useEffect(() => {
    const aoMudar = (e: Event) => {
      for (const id of quadros.current.keys()) enviar(id, { tipo: "tema", tema: (e as CustomEvent<Tema>).detail });
    };
    window.addEventListener(EVENTO_TEMA, aoMudar);
    return () => window.removeEventListener(EVENTO_TEMA, aoMudar);
  }, [enviar]);

  const visivel = !!rota;
  const desconhecido = rota && !menu.some((m) => m.id === rota.modulo);
  return (
    <div className="area-modulos" hidden={!visivel}>
      {desconhecido && (
        <div className="centro">
          <p className="mensagem-acesso">Este módulo não existe ou seu perfil não tem acesso a ele.</p>
        </div>
      )}
      {abertos.map((a) => {
        const m = menu.find((x) => x.id === a.id);
        if (!m) return null;
        const ativo = rota?.modulo === a.id;
        return (
          <iframe
            key={`${a.id}:${a.versao}`}
            title={m.nome}
            src={a.versao ? `${m.prefixo}${rotas.current.get(a.id) ?? "/"}` : a.src}
            className="quadro-modulo"
            hidden={!ativo}
            data-modulo={a.id}
            ref={(f) => {
              if (f) quadros.current.set(a.id, f);
              else quadros.current.delete(a.id);
            }}
            onLoad={() => enviar(a.id, { tipo: "tema", tema: lerTema() })}
          />
        );
      })}
    </div>
  );
}
