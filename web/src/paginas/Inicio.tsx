/** Início: as áreas e telas que o perfil pode abrir, com os mesmos títulos do menu lateral. */
import { Link } from "react-router";
import { useSessao } from "plataforma-kit/react";
import type { ModuloMenu } from "../api.ts";
import { agruparPorArea } from "../componentes/Lateral.tsx";

const destino = (modulo: string, caminho: string) => `/m/${modulo}${caminho === "/" ? "" : caminho}`;

export function Inicio({ menu, carregando }: { menu: ModuloMenu[]; carregando: boolean }) {
  const { usuario } = useSessao();
  const areas = agruparPorArea(menu);
  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <h1>Olá, {usuario?.nome.split(" ")[0]}</h1>
      </div>
      {carregando ? null : areas.length ? (
        <div className="grade-modulos">
          {areas.map((a) => (
            <section key={a.chave} className="cartao-modulo">
              <h2>{a.titulo}</h2>
              {a.modulos.map((m) => (
                <div key={m.id}>
                  {a.modulos.length > 1 && <h3 className="cartao-subtitulo">{m.nome}</h3>}
                  {!m.noAr && <p className="aviso">O módulo não respondeu na última verificação.</p>}
                  <ul>
                    {m.itens.map((i) => (
                      <li key={i.id}>
                        <Link to={destino(m.id, i.caminho)}>{i.rotulo}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <p className="mensagem-acesso">
          Seu perfil ainda não tem acesso a nenhum módulo. Fale com o administrador do portal.
        </p>
      )}
    </div>
  );
}
