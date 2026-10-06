/** Início: os módulos que o perfil pode abrir. */
import { Link } from "react-router";
import { useSessao } from "plataforma-kit/react";
import type { ModuloMenu } from "../api.ts";

export function Inicio({ menu, carregando }: { menu: ModuloMenu[]; carregando: boolean }) {
  const { usuario } = useSessao();
  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <h1>Olá, {usuario?.nome.split(" ")[0]}</h1>
      </div>
      {carregando ? null : menu.length ? (
        <div className="grade-modulos">
          {menu.map((m) => (
            <section key={m.id} className="cartao-modulo">
              <h2>{m.nome}</h2>
              {!m.noAr && <p className="aviso">O módulo não respondeu na última verificação.</p>}
              <ul>
                {m.itens.map((i) => (
                  <li key={i.id}>
                    <Link to={`/m/${m.id}${i.caminho === "/" ? "" : i.caminho}`}>{i.rotulo}</Link>
                  </li>
                ))}
              </ul>
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
