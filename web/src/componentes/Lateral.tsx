/** Menu lateral: módulos e itens vindos dos manifestos (já filtrados pelo servidor) e a administração. */
import { NavLink, useLocation } from "react-router";
import { Activity, Home, Upload, Users } from "lucide-react";
import { useSessao } from "plataforma-kit/react";
import type { ModuloMenu } from "../api.ts";

/** "/m/cronogramas/modelos/1" -> { modulo: "cronogramas", caminho: "/modelos/1" } */
export function rotaDoPortal(pathname: string) {
  const m = pathname.match(/^\/m\/([a-z][a-z0-9_]*)(\/.*)?$/);
  return m ? { modulo: m[1], caminho: m[2] || "/" } : null;
}

/** Item ativo: o de caminho mais longo que é início do caminho atual ("/" só quando é exatamente "/"). */
function itemAtivo(m: ModuloMenu, caminho: string) {
  let melhor: string | null = null;
  for (const i of m.itens) {
    const casa = i.caminho === "/" ? caminho === "/" : caminho === i.caminho || caminho.startsWith(`${i.caminho}/`);
    if (casa && (!melhor || i.caminho.length > melhor.length)) melhor = i.id;
  }
  return melhor;
}

const SeloForaDoAr = () => (
  <span className="selo selo-cancelado" title="O módulo não respondeu na última verificação">
    fora do ar
  </span>
);

/**
 * Áreas do menu: módulos com o mesmo "grupo" do manifesto ficam sob um único título (ex.: Financeiro → Orçamentos e,
 * depois, DRE); módulo sem grupo é uma área sozinho, com o próprio nome. A ordem é a do registro.
 */
export function agruparPorArea(menu: ModuloMenu[]) {
  const areas: { chave: string; titulo: string; modulos: ModuloMenu[] }[] = [];
  for (const m of menu) {
    const chave = m.grupo ? `grupo:${m.grupo.toLowerCase()}` : `modulo:${m.id}`;
    const area = areas.find((a) => a.chave === chave);
    if (area) area.modulos.push(m);
    else areas.push({ chave, titulo: m.grupo ?? m.nome, modulos: [m] });
  }
  return areas;
}

export function Lateral({ menu, carregando }: { menu: ModuloMenu[]; carregando: boolean }) {
  const { usuario, pode } = useSessao();
  const local = useLocation();
  const rota = rotaDoPortal(local.pathname);
  return (
    <nav className="lateral-portal" aria-label="Módulos">
      <NavLink to="/" end className="lateral-item">
        <Home size={15} aria-hidden /> Início
      </NavLink>
      {agruparPorArea(menu).map((area) => (
        <div key={area.chave} className="lateral-grupo">
          <div className="lateral-titulo">
            {area.titulo}
            {area.modulos.length === 1 && !area.modulos[0].noAr && <SeloForaDoAr />}
          </div>
          {area.modulos.map((m) => {
            const ativo = rota?.modulo === m.id ? itemAtivo(m, rota.caminho) : null;
            return (
              <div key={m.id} className="lateral-modulo">
                {area.modulos.length > 1 && (
                  <div className="lateral-subtitulo">
                    {m.nome}
                    {!m.noAr && <SeloForaDoAr />}
                  </div>
                )}
                {m.itens.map((i) => (
                  <NavLink
                    key={i.id}
                    to={`/m/${m.id}${i.caminho === "/" ? "" : i.caminho}`}
                    className={() => `lateral-item${ativo === i.id ? " active" : ""}`}
                    aria-current={ativo === i.id ? "page" : undefined}
                  >
                    {i.rotulo}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </div>
      ))}
      {!carregando && !menu.length && <p className="lateral-vazio">Seu perfil ainda não tem acesso a nenhum módulo.</p>}
      {(usuario?.administrador || pode("portal.modulos.ver")) && (
        <div className="lateral-grupo lateral-admin">
          <div className="lateral-titulo">Administração</div>
          {usuario?.administrador && (
            <NavLink to="/admin/usuarios" className="lateral-item">
              <Users size={15} aria-hidden /> Usuários e perfis
            </NavLink>
          )}
          <NavLink to="/admin/modulos" className="lateral-item">
            <Activity size={15} aria-hidden /> Módulos
          </NavLink>
          {usuario?.administrador && (
            <NavLink to="/admin/importacao" className="lateral-item">
              <Upload size={15} aria-hidden /> Importar do Cronogramas
            </NavLink>
          )}
        </div>
      )}
    </nav>
  );
}
