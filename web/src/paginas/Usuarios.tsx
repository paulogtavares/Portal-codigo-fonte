/**
 * Usuários e perfis do portal (Plano 4, etapa 5): a tela do kit com o catálogo de todos os módulos, uma seção por
 * módulo ("Ativar visão de …"). O cliente do usuário externo vem da tabela de clientes de referência.
 */
import { useQuery } from "@tanstack/react-query";
import { Campo, TelaUsuarios, type ExtensaoUsuario, type UsuarioAdmin } from "plataforma-kit/react";
import { cliente, type ClienteRef } from "../api.ts";

const PERMISSAO_INTERNA = "portal.interno";

function CamposCliente({ externo, valor, mudar }: { externo: boolean; valor: string; mudar: (v: string) => void }) {
  const clientes = useQuery({ queryKey: ["clientes"], queryFn: () => cliente.get<ClienteRef[]>("/portal/clientes") });
  if (!externo) return null;
  const lista = (clientes.data ?? []).filter((c) => c.ativo || c.id === valor);
  return (
    <Campo
      rotulo="Cliente"
      dica={
        lista.length
          ? "O usuário externo vê só o que é do cliente dele nos módulos."
          : "Nenhum cliente cadastrado: importe os do Cronogramas (Administração → Importar do Cronogramas)."
      }
    >
      <select value={valor} onChange={(e) => mudar(e.target.value)} required>
        <option value="">Escolha o cliente</option>
        {lista.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </select>
    </Campo>
  );
}

const extensao: ExtensaoUsuario<UsuarioAdmin, string> = {
  inicial: (u) => u?.cliente_id ?? "",
  Campos: ({ externo, valor, mudar }) => <CamposCliente externo={externo} valor={valor} mudar={mudar} />,
  dados: (valor, externo) => ({ cliente_id: externo && valor ? valor : null }),
};

export function Usuarios() {
  return (
    <TelaUsuarios
      permissaoInterna={PERMISSAO_INTERNA}
      nomePlataforma="plataforma"
      extensao={extensao}
      complementoPerfil={(u) => (u.cliente_nome ? ` (${String(u.cliente_nome)})` : null)}
      textoAdministrador="Administrador (todas as permissões em todos os módulos; cadastra usuários e perfis)"
      avisoSemInterna={
        <p className="dica-campo">
          Sem “Equipe interna”, os usuários deste perfil são externos (de um cliente) e não podem ser administradores.
        </p>
      }
    />
  );
}
