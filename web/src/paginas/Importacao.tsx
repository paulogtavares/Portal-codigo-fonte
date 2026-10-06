/**
 * Importação dos usuários do Cronogramas (Plano 4, etapa 5): o arquivo da exportação é conferido numa simulação
 * (o resultado exato, desfeito no fim) e só então importado.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAvisos } from "plataforma-kit/react";
import { cliente, type ResumoImportacao } from "../api.ts";

function Resumo({ r }: { r: ResumoImportacao }) {
  const u = r.usuarios;
  return (
    <div className="resumo-importacao">
      <h2>{r.simulacao ? "Prévia (nada foi gravado)" : "Importação concluída"}</h2>
      <ul>
        <li>
          Clientes: {r.clientes.criados} novos, {r.clientes.atualizados} atualizados
        </li>
        <li>
          Perfis: {r.perfis.criados.length} novos{r.perfis.criados.length ? ` (${r.perfis.criados.join(", ")})` : ""},{" "}
          {r.perfis.atualizados.length} atualizados
          {r.perfis.atualizados.length ? ` (${r.perfis.atualizados.join(", ")})` : ""}
        </li>
        {r.perfis.renomeados.map((x) => (
          <li key={x.de}>
            Perfil “{x.de}” entra como “{x.para}” (o nome já existia no portal)
          </li>
        ))}
        <li>
          Usuários: {u.criados} novos, {u.atualizados} atualizados, {u.comSenhaDoCronogramas} entram com a senha que já
          usam no Cronogramas
        </li>
        {u.reconciliados.map((x) => (
          <li key={x.email}>{x.email}: o usuário do portal passa a ter o mesmo id do Cronogramas</li>
        ))}
      </ul>
      {!!u.semSenha.length && (
        <p className="aviso">
          Sem senha (o administrador gera uma senha provisória em Usuários e perfis): {u.semSenha.join(", ")}
        </p>
      )}
      {!!u.conflitos.length && (
        <div className="aviso aviso-erro">
          <strong>Ficam de fora:</strong>
          <ul>
            {u.conflitos.map((c) => (
              <li key={c.email}>
                {c.email}: {c.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.avisos.map((a) => (
        <p key={a} className="aviso">
          {a}
        </p>
      ))}
    </div>
  );
}

export function Importacao() {
  const { erro, avisar } = useAvisos();
  const qc = useQueryClient();
  const [dados, setDados] = useState<unknown>(null);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [reconciliar, setReconciliar] = useState(true);
  const [resumo, setResumo] = useState<ResumoImportacao | null>(null);
  const historico = useQuery({
    queryKey: ["importacoes"],
    queryFn: () =>
      cliente.get<{ id: string; feita_em: string; feita_por: string | null; resumo: ResumoImportacao }[]>(
        "/portal/importacoes",
      ),
  });
  const enviar = useMutation({
    mutationFn: (simular: boolean) =>
      cliente.post<ResumoImportacao>("/portal/importacao/cronogramas", {
        dados,
        simular,
        reconciliarPorEmail: reconciliar,
      }),
    onSuccess: (r) => {
      setResumo(r);
      if (!r.simulacao) {
        avisar("Usuários do Cronogramas importados.");
        setDados(null);
        qc.invalidateQueries({ queryKey: ["importacoes"] });
        qc.invalidateQueries({ queryKey: ["clientes"] });
      }
    },
    onError: erro,
  });

  async function escolher(arquivo: File | undefined) {
    setResumo(null);
    if (!arquivo) return;
    try {
      setDados(JSON.parse(await arquivo.text()));
      setNomeArquivo(arquivo.name);
    } catch {
      setDados(null);
      erro(new Error("O arquivo não é um JSON válido."));
    }
  }

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <h1>Importar usuários do Cronogramas</h1>
      </div>
      <p className="texto-apoio">
        Gere o arquivo com a ferramenta <code>exportar-cronogramas.js</code> do pacote do portal (veja o LEIA-ME). Os
        ids são mantidos, os perfis viram perfis do portal e cada pessoa entra com a senha que já usa no Cronogramas. O
        arquivo traz o hash das senhas: apague-o depois de importar.
      </p>
      <div className="formulario cartao-importacao">
        <label className="campo">
          <span className="rotulo-campo">Arquivo da exportação (.json)</span>
          <input type="file" accept=".json,application/json" onChange={(e) => escolher(e.target.files?.[0])} />
        </label>
        <label className="opcao">
          <input
            type="checkbox"
            checked={reconciliar}
            onChange={(e) => {
              setReconciliar(e.target.checked);
              setResumo(null);
            }}
          />
          Reconciliar por e-mail: quem já existe no portal com o mesmo e-mail passa a ter o id do Cronogramas
        </label>
        <div className="linha-inline">
          <button className="botao" disabled={!dados || enviar.isPending} onClick={() => enviar.mutate(true)}>
            Conferir (prévia)
          </button>
          <button
            className="botao botao-primario"
            disabled={!dados || !resumo?.simulacao || enviar.isPending}
            title={resumo?.simulacao ? "" : "Confira a prévia antes de importar"}
            onClick={() => enviar.mutate(false)}
          >
            Importar {nomeArquivo && `“${nomeArquivo}”`}
          </button>
        </div>
      </div>
      {resumo && <Resumo r={resumo} />}
      <h2 className="titulo-secao">Importações anteriores</h2>
      {historico.data?.length ? (
        <ul className="historico">
          {historico.data.map((h) => (
            <li key={h.id}>
              {new Date(h.feita_em).toLocaleString("pt-BR")} · {h.feita_por ?? "—"} · {h.resumo.usuarios.criados} novos,{" "}
              {h.resumo.usuarios.atualizados} atualizados, {h.resumo.usuarios.conflitos.length} de fora
            </li>
          ))}
        </ul>
      ) : (
        <p className="texto-apoio">Nenhuma importação feita.</p>
      )}
    </div>
  );
}
