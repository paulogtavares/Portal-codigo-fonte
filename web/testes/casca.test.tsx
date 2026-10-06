/** Casca (etapa 4): menu lateral, um iframe por módulo e a URL do portal acompanhando o módulo. */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProvedorAvisos, ProvedorSessao } from "plataforma-kit/react";
import type { ModuloMenu } from "../src/api.ts";
import { cliente } from "../src/api.ts";
import { AreaModulos } from "../src/componentes/AreaModulos.tsx";
import { Lateral, rotaDoPortal } from "../src/componentes/Lateral.tsx";

const menu: ModuloMenu[] = [
  {
    id: "cronogramas",
    nome: "Cronogramas",
    prefixo: "/cronogramas",
    noAr: true,
    itens: [
      { id: "implantacao", rotulo: "Cronogramas", caminho: "/implantacao" },
      { id: "modelos", rotulo: "Modelos", caminho: "/modelos" },
    ],
  },
  {
    id: "orcamentos",
    nome: "Orçamentos",
    prefixo: "/financeiro/orcamentos",
    noAr: false,
    itens: [{ id: "orcamentos", rotulo: "Orçamentos", caminho: "/" }],
  },
];

const usuario = {
  id: "u",
  nome: "Ana Souza",
  email: "a@x",
  tipo: "interno" as const,
  administrador: true,
  permissoes: [],
};
let local: ReturnType<typeof useLocation>;
function Espiao() {
  local = useLocation();
  return null;
}

function montar(inicio: string, conteudo: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[inicio]}>
      <QueryClientProvider client={new QueryClient()}>
        <ProvedorAvisos>
          <ProvedorSessao cliente={cliente} fixo={{ usuario, carregando: false }}>
            <Espiao />
            {conteudo}
          </ProvedorSessao>
        </ProvedorAvisos>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** mensagem vinda de um iframe do portal (mesma origem) */
function doModulo(modulo: string, data: unknown, origem = window.location.origin) {
  const f = document.querySelector<HTMLIFrameElement>(`iframe[data-modulo=${modulo}]`)!;
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { origin: origem, source: f.contentWindow, data }));
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("rotas do portal", () => {
  it("/m/<módulo><caminho>", () => {
    expect(rotaDoPortal("/m/cronogramas/modelos/1")).toEqual({ modulo: "cronogramas", caminho: "/modelos/1" });
    expect(rotaDoPortal("/m/orcamentos")).toEqual({ modulo: "orcamentos", caminho: "/" });
    expect(rotaDoPortal("/admin/usuarios")).toBeNull();
  });
});

describe("menu lateral", () => {
  it("módulos, itens, aviso de fora do ar, item ativo e administração", () => {
    montar("/m/cronogramas/modelos/abc", <Lateral menu={menu} carregando={false} />);
    expect(screen.getByRole("link", { name: "Modelos" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Cronogramas" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Orçamentos" }).getAttribute("href")).toBe("/m/orcamentos");
    expect(screen.getByText("fora do ar")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Usuários e perfis/ })).toBeTruthy();
  });

  it("sem módulos: explica que o perfil não tem acesso", () => {
    montar("/", <Lateral menu={[]} carregando={false} />);
    expect(screen.getByText(/não tem acesso a nenhum módulo/)).toBeTruthy();
  });
});

describe("área dos módulos", () => {
  it("abre o iframe no prefixo com o caminho da URL do portal", () => {
    montar("/m/cronogramas/modelos?x=1", <AreaModulos menu={menu} />);
    const f = document.querySelector<HTMLIFrameElement>("iframe[data-modulo=cronogramas]")!;
    expect(f.getAttribute("src")).toBe("/cronogramas/modelos?x=1");
    expect(f.hidden).toBe(false);
  });

  it("rota-alterada do módulo troca o endereço do portal (sem navegar o iframe de novo)", () => {
    montar("/m/cronogramas", <AreaModulos menu={menu} />);
    const f = document.querySelector<HTMLIFrameElement>("iframe[data-modulo=cronogramas]")!;
    const enviar = vi.spyOn(f.contentWindow!, "postMessage");
    doModulo("cronogramas", {
      tipo: "rota-alterada",
      modulo: "cronogramas",
      caminho: "/implantacao",
      titulo: "Cronogramas",
    });
    expect(local.pathname).toBe("/m/cronogramas/implantacao");
    expect(enviar).not.toHaveBeenCalledWith(expect.objectContaining({ tipo: "navegar" }), expect.anything());
    expect(document.title).toBe("Cronogramas · Portal");
  });

  it("ignora mensagens de outra origem e caminhos perigosos", () => {
    montar("/m/cronogramas", <AreaModulos menu={menu} />);
    doModulo("cronogramas", { tipo: "rota-alterada", caminho: "/x" }, "https://outro.site");
    expect(local.pathname).toBe("/m/cronogramas");
    doModulo("cronogramas", { tipo: "rota-alterada", caminho: "//outro.site/x" });
    expect(local.pathname).toBe("/m/cronogramas");
  });

  it("sessao-expirada com a sessão do portal encerrada volta ao login", async () => {
    vi.spyOn(cliente, "get").mockRejectedValue(Object.assign(new Error("x"), { status: 401 }));
    const expirou = vi.fn();
    window.addEventListener("portal:sessao-expirada", expirou);
    montar("/m/cronogramas", <AreaModulos menu={menu} />);
    doModulo("cronogramas", { tipo: "sessao-expirada", modulo: "cronogramas" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(expirou).toHaveBeenCalled();
    window.removeEventListener("portal:sessao-expirada", expirou);
  });

  it("módulo sem acesso pela URL: mensagem, sem iframe", () => {
    montar("/m/cp/x", <AreaModulos menu={menu} />);
    expect(screen.getByText(/não existe ou seu perfil não tem acesso/)).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
  });
});
