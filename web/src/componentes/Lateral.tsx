/** Menu lateral: módulos e itens vindos dos manifestos (já filtrados pelo servidor) e a administração. */
import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import { Activity, ChevronRight, Home, Upload, Users } from "lucide-react";
import { useSessao } from "plataforma-kit/react";
import type { ModuloMenu } from "../api.ts";

/** "/m/cronogramas/modelos/1" -> { modulo: "cronogramas", caminho: "/modelos/1" } */
export function rotaDoPortal(pathname: string) {
  const m = pathname.match(/^\/m\/([a-z][a-z0-9_]*)(\/.*)?$/);
  return m ? { modulo: m[1], caminho: m[2] || "/" } : null;
}

const casa = (destino: string, caminho: string) =>
  destino === "/" ? caminho === "/" : caminho === destino || caminho.startsWith(`${destino}/`);

/**
 * Tela ativa: o item (ou submenu) de caminho mais longo que é início do caminho atual ("/" só quando é exatamente
 * "/"). Devolve a chave "item" ou "item/filho" e o item pai, para abrir o grupo.
 */
export function itemAtivo(m: ModuloMenu, caminho: string): { chave: string; pai: string | null } | null {
  let melhor: { chave: string; pai: string | null; tamanho: number } | null = null;
  const considerar = (chave: string, pai: string | null, destino: string) => {
    if (casa(destino, caminho) && (!melhor || destino.length > melhor.tamanho))
      melhor = { chave, pai, tamanho: destino.length };
  };
  for (const i of m.itens) {
    if (i.filhos?.length) for (const f of i.filhos) considerar(`${i.id}/${f.id}`, i.id, f.caminho);
    else considerar(i.id, null, i.caminho);
  }
  const achado = melhor as { chave: string; pai: string | null } | null;
  return achado ? { chave: achado.chave, pai: achado.pai } : null;
}

const destinoNoPortal = (modulo: string, caminho: string) => `/m/${modulo}${caminho === "/" ? "" : caminho}`;

/** Itens de um módulo; os que têm submenus viram grupos que abrem (abertos quando a tela ativa está neles). */
function ItensDoModulo({ m, ativo }: { m: ModuloMenu; ativo: ReturnType<typeof itemAtivo> }) {
  // grupos abertos pela pessoa e grupos da tela ativa que ela fechou
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set());
  const [fechados, setFechados] = useState<Set<string>>(() => new Set());
  const trocar = (s: Set<string>, id: string) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };
  return (
    <>
      {m.itens.map((i) => {
        if (!i.filhos?.length)
          return (
            <NavLink
              key={i.id}
              to={destinoNoPortal(m.id, i.caminho)}
              className={() => `lateral-item${ativo?.chave === i.id ? " active" : ""}`}
              aria-current={ativo?.chave === i.id ? "page" : undefined}
            >
              {i.rotulo}
            </NavLink>
          );
        const contemAtivo = ativo?.pai === i.id;
        // o grupo da tela ativa fica aberto (a pessoa pode fechar); os outros abrem com um clique
        const aberto = contemAtivo ? !fechados.has(i.id) : abertos.has(i.id);
        return (
          <div key={i.id} className={`lateral-pai${contemAtivo ? " contem-ativo" : ""}`}>
            <button
              type="button"
              className="lateral-item lateral-pai-titulo"
              aria-expanded={aberto}
              onClick={() => (contemAtivo ? setFechados((s) => trocar(s, i.id)) : setAbertos((s) => trocar(s, i.id)))}
            >
              <ChevronRight size={14} className="lateral-seta" aria-hidden />
              {i.rotulo}
            </button>
            {aberto && (
              <div className="lateral-filhos">
                {i.filhos.map((f) => {
                  const chave = `${i.id}/${f.id}`;
                  return (
                    <NavLink
                      key={f.id}
                      to={destinoNoPortal(m.id, f.caminho)}
                      className={() => `lateral-item lateral-filho${ativo?.chave === chave ? " active" : ""}`}
                      aria-current={ativo?.chave === chave ? "page" : undefined}
                    >
                      {f.rotulo}
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
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
                <ItensDoModulo m={m} ativo={ativo} />
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
