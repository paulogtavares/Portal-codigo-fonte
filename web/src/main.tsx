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
