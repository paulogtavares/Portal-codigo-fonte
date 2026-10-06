import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import type { Tema } from "plataforma-kit/web";
import { lerTema, mudarTema } from "../tema.ts";

const OPCOES: { tema: Tema; rotulo: string; Icone: typeof Sun }[] = [
  { tema: "claro", rotulo: "Tema claro", Icone: Sun },
  { tema: "escuro", rotulo: "Tema escuro", Icone: Moon },
  { tema: "sistema", rotulo: "Tema do sistema", Icone: Monitor },
];

/** Alterna claro → escuro → sistema. */
export function SeletorTema() {
  const [tema, setTema] = useState<Tema>(lerTema);
  const i = OPCOES.findIndex((o) => o.tema === tema);
  const atual = OPCOES[i];
  const proximo = OPCOES[(i + 1) % OPCOES.length];
  return (
    <button
      type="button"
      className="botao-topo"
      title={`${atual.rotulo} (clique para ${proximo.rotulo.toLowerCase()})`}
      aria-label={atual.rotulo}
      onClick={() => {
        mudarTema(proximo.tema);
        setTema(proximo.tema);
      }}
    >
      <atual.Icone size={16} />
    </button>
  );
}
