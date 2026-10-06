/** Saúde dos módulos (Plano 4, etapa 6): versão, situação, modo de login e de onde veio cada informação. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useAvisos, useSessao } from "plataforma-kit/react";
import { cliente, type SituacaoModulo, type SituacaoModulos } from "../api.ts";

const dataHora = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

function Situacao({ m }: { m: SituacaoModulo }) {
  if (!m.saude) return <span className="selo">não verificado</span>;
  return m.saude.ok ? (
    <span className="selo selo-concluido" title={`Verificado ${dataHora(m.saude.verificadoEm)}`}>
      no ar · {m.saude.ms} ms
    </span>
  ) : (
    <span className="selo selo-cancelado" title={`Verificado ${dataHora(m.saude.verificadoEm)}`}>
      fora do ar
    </span>
  );
}

function Login({ m }: { m: SituacaoModulo }) {
  if (!m.autenticacao) return <span className="selo">desconhecido</span>;
  return m.autenticacao === "portal" ? (
    <span className="selo selo-concluido">portal</span>
  ) : (
    <span className="selo selo-pausado" title="Com login próprio o módulo não funciona atrás do portal">
      {m.autenticacao}
    </span>
  );
}

export function Modulos() {
  const { usuario } = useSessao();
  const { erro } = useAvisos();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["modulos"], queryFn: () => cliente.get<SituacaoModulos>("/portal/modulos") });
  const atualizar = useMutation({
    mutationFn: () => cliente.post<SituacaoModulos>("/portal/modulos/atualizar"),
    onSuccess: (d) => qc.setQueryData(["modulos"], d),
    onError: erro,
  });
  const d = q.data;
  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <h1>Módulos</h1>
        <button className="botao" onClick={() => atualizar.mutate()} disabled={atualizar.isPending}>
          <RefreshCw size={14} /> {atualizar.isPending ? "Verificando…" : "Verificar agora"}
        </button>
      </div>
      <p className="texto-apoio">
        Última verificação: {dataHora(d?.ultimaAtualizacao ?? null)}. O portal relê os módulos a cada minuto.
      </p>
      {q.error && <p className="aviso aviso-erro">{(q.error as Error).message}</p>}
      <div className="rolagem-tabela">
        <table className="tabela-portal">
          <thead>
            <tr>
              <th>Módulo</th>
              <th>Versão</th>
              <th>Situação</th>
              <th>Login</th>
              <th>Prefixo</th>
              {usuario?.administrador && <th>Endereço interno</th>}
              <th>Manifesto</th>
            </tr>
          </thead>
          <tbody>
            {d?.modulos.map((m) => (
              <tr key={m.id}>
                <td>
                  <strong>{m.nome}</strong>
                  <div className="texto-apoio">
                    {m.id}
                    {m.grupo && ` · área ${m.grupo}`}
                  </div>
                </td>
                <td>{m.versao ? `v${m.versao}` : "—"}</td>
                <td>
                  <Situacao m={m} />
                  {m.saude?.erro && <div className="texto-apoio">{m.saude.erro}</div>}
                </td>
                <td>
                  <Login m={m} />
                </td>
                <td>
                  <code>{m.prefixo}</code>
                  <div className="texto-apoio">
                    {m.origemPrefixo === "variavel"
                      ? "da variável MODULOS"
                      : m.origemPrefixo === "manifesto"
                        ? "do manifesto"
                        : "padrão"}
                  </div>
                </td>
                {usuario?.administrador && (
                  <td>
                    <code>{m.url}</code>
                  </td>
                )}
                <td>
                  {m.fonteManifesto === "ao-vivo"
                    ? `lido ${dataHora(m.manifestoLidoEm)}`
                    : m.fonteManifesto === "guardado"
                      ? `guardado de ${dataHora(m.manifestoLidoEm)}`
                      : "nunca lido"}
                  <div className="texto-apoio">{m.permissoes} permissões</div>
                  {m.erroManifesto && <div className="texto-apoio">{m.erroManifesto}</div>}
                  {m.avisos.map((a) => (
                    <div key={a} className="texto-apoio">
                      {a}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
            {d && !d.modulos.length && (
              <tr>
                <td colSpan={7}>Nenhum módulo registrado. Defina a variável MODULOS e reinicie o portal.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
