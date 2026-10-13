/** Telas do portal: login, troca de senha e a casca (barra superior, menu lateral, módulos e administração). */
import { useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Menu, X } from "lucide-react";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { Casca, TelaLogin, TelaTrocaSenha, useSessao } from "plataforma-kit/react";
import { cliente, type ModuloMenu } from "./api.ts";
import { AreaModulos } from "./componentes/AreaModulos.tsx";
import { Lateral } from "./componentes/Lateral.tsx";
import { SeletorTema } from "./componentes/SeletorTema.tsx";
import { Inicio } from "./paginas/Inicio.tsx";
import { Usuarios } from "./paginas/Usuarios.tsx";
import { Modulos } from "./paginas/Modulos.tsx";
import { Importacao } from "./paginas/Importacao.tsx";

export const consultas = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

export const Marca = () => (
  <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden className="marca-portal">
    <rect x="3" y="3" width="11" height="11" rx="2" fill="currentColor" />
    <rect x="18" y="3" width="11" height="11" rx="2" fill="currentColor" opacity=".5" />
    <rect x="3" y="18" width="11" height="11" rx="2" fill="currentColor" opacity=".5" />
    <rect x="18" y="18" width="11" height="11" rx="2" fill="currentColor" />
  </svg>
);

/** Botão do menu lateral no celular e em telas estreitas (no computador o menu fica sempre à mostra). */
function BotaoMenu({ aberto, alternar }: { aberto: boolean; alternar: () => void }) {
  return (
    <button
      type="button"
      className="botao-menu-portal"
      aria-label={aberto ? "Fechar o menu" : "Abrir o menu"}
      aria-expanded={aberto}
      aria-controls="menu-portal"
      onClick={alternar}
    >
      {aberto ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
    </button>
  );
}

function Portal() {
  const [menuAberto, setMenuAberto] = useState(false);
  const { usuario, pode } = useSessao();
  const menu = useQuery({
    queryKey: ["menu", usuario?.id],
    queryFn: () => cliente.get<ModuloMenu[]>("/portal/menu"),
    refetchInterval: 60_000,
  });
  const lista = menu.data ?? [];
  return (
    <div className="app-portal">
      <Casca
        abas={<BotaoMenu aberto={menuAberto} alternar={() => setMenuAberto((a) => !a)} />}
        nome="Portal"
        marca={<Marca />}
        versao={__VERSAO__}
        data={__DATA__}
        embutido={false}
        acoes={<SeletorTema />}
      />
      <div className="corpo-portal">
        <Lateral menu={lista} carregando={menu.isLoading} aberta={menuAberto} fechar={() => setMenuAberto(false)} />
        <main className="conteudo-portal">
          <AreaModulos menu={lista} />
          <Routes>
            <Route path="/" element={<Inicio menu={lista} carregando={menu.isLoading} />} />
            <Route path="/m/*" element={null} />
            {usuario?.administrador && <Route path="/admin/usuarios" element={<Usuarios />} />}
            {(usuario?.administrador || pode("portal.modulos.ver")) && (
              <Route path="/admin/modulos" element={<Modulos />} />
            )}
            {usuario?.administrador && <Route path="/admin/importacao" element={<Importacao />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export function App() {
  const { usuario, carregando } = useSessao();
  if (carregando) return null;
  if (!usuario)
    return (
      <TelaLogin
        subtitulo="Portal da plataforma Infracommerce"
        marca={<Marca />}
        buscarStatus={() => cliente.get("/status")}
      />
    );
  if (usuario.precisa_trocar_senha) return <TelaTrocaSenha />;
  return <Portal />;
}
