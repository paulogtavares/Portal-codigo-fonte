import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import "plataforma-kit/tokens.css";
import "plataforma-kit/componentes.css";
import "./estilos.css";
import { ProvedorAvisos, ProvedorSessao } from "plataforma-kit/react";
import { aplicarTema, BASENAME } from "plataforma-kit/web";
import { cliente, EVENTO_SESSAO_EXPIRADA } from "./api.ts";
import { lerTema } from "./tema.ts";
import { App, consultas } from "./App.tsx";

aplicarTema(lerTema());

/**
 * O portal nunca roda dentro de um quadro do próprio portal. Se um módulo sair do prefixo dele (ex.: ir para "/" ao
 * perder a sessão), o quadro carregaria o portal de novo, com outra tela de login dentro da tela. Nesse caso, quem
 * navega é a janela principal: ela mostra o login (sessão encerrada) ou o início.
 */
function dentroDoProprioPortal() {
  try {
    return window.self !== window.top && window.top!.location.origin === window.location.origin;
  } catch {
    return false; // quadro de outra origem: o navegador já bloqueia (frame-ancestors 'self')
  }
}

if (dentroDoProprioPortal()) {
  window.top!.location.replace("/");
} else {
  createRoot(document.getElementById("raiz")!).render(
    <StrictMode>
      <BrowserRouter basename={BASENAME}>
        <QueryClientProvider client={consultas}>
          <ProvedorAvisos>
            <ProvedorSessao
              cliente={cliente}
              eventoSessaoExpirada={EVENTO_SESSAO_EXPIRADA}
              aoMudarUsuario={() => consultas.clear()}
            >
              <App />
            </ProvedorSessao>
          </ProvedorAvisos>
        </QueryClientProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}
