/** Menu pelas visões do perfil (decisão de 02/10/2026). */
import { describe, expect, it } from "vitest";
import { montarMenu, temVisao } from "../src/menu.ts";
import type { EstadoModulo } from "../src/modulos.ts";

const modulo = (id: string, menu: any[], autenticacao = "portal", ok = true): EstadoModulo => ({
  id,
  url: "http://x",
  prefixo: `/${id}`,
  origemPrefixo: "padrao",
  manifesto: { id, url: "", ok: true, nome: id.toUpperCase(), autenticacao, menu, permissoes: [], avisos: [] },
  fonteManifesto: "ao-vivo",
  manifestoLidoEm: null,
  saude: { ok, verificadoEm: "" },
});

const cron = modulo("cronogramas", [
  { id: "implantacao", rotulo: "Cronogramas", caminho: "/implantacao" },
  { id: "simulacoes", rotulo: "Simulações", caminho: "/simulacoes", exigeAlguma: ["cronogramas.simulacoes.criar"] },
  { id: "usuarios", rotulo: "Usuários e perfis", caminho: "/usuarios", somenteAdministrador: true },
  { id: "admin", rotulo: "Só admin", caminho: "/admin", somenteAdministrador: true },
  { id: "externo", rotulo: "Externo", caminho: "//site.com" },
]);
const orc = modulo("orcamentos", [
  { id: "orcamentos", rotulo: "Orçamentos", caminho: "/", exigeAlguma: ["orcamentos.ver"] },
  { id: "custos", rotulo: "Custos", caminho: "/custos", exigeAlguma: ["orcamentos.custos.ver"] },
]);

describe("menu", () => {
  it("módulo só aparece com ao menos uma permissão dele; cada item respeita exigeAlguma", () => {
    const m = montarMenu([cron, orc], { administrador: false, permissoes: ["orcamentos.ver"] });
    expect(m.map((x) => x.id)).toEqual(["orcamentos"]);
    expect(m[0].itens.map((i) => i.id)).toEqual(["orcamentos"]);
  });

  it("item sem exigeAlguma aparece para quem vê o módulo; somenteAdministrador não", () => {
    const m = montarMenu([cron], { administrador: false, permissoes: ["cronogramas.criar"] });
    expect(m[0].itens.map((i) => i.id)).toEqual(["implantacao"]);
  });

  it("administrador vê tudo, menos Usuários e perfis dos módulos (o portal assume) e caminhos inválidos", () => {
    const m = montarMenu([cron, orc], { administrador: true, permissoes: [] });
    expect(m.map((x) => x.id)).toEqual(["cronogramas", "orcamentos"]);
    expect(m[0].itens.map((i) => i.id)).toEqual(["implantacao", "simulacoes", "admin"]);
  });

  it("módulo em modo local fica de fora; fora do ar aparece marcado", () => {
    const local = { ...orc, manifesto: { ...orc.manifesto!, autenticacao: "local" } };
    expect(montarMenu([local], { administrador: true, permissoes: [] })).toEqual([]);
    const fora = { ...orc, saude: { ok: false, verificadoEm: "" } };
    expect(montarMenu([fora], { administrador: true, permissoes: [] })[0].noAr).toBe(false);
  });

  it("permissão de outro módulo com o mesmo começo não dá visão", () => {
    expect(temVisao({ administrador: false, permissoes: ["cronogramasx.ver"] }, "cronogramas")).toBe(false);
  });
});

describe("submenus (kit 1.7.0)", () => {
  const cp = modulo("cp", [
    { id: "dashboard", rotulo: "Dashboard", caminho: "/", exigeAlguma: ["cp.ver"] },
    {
      id: "projetos",
      rotulo: "Projetos",
      caminho: "/projetos/board",
      exigeAlguma: ["cp.ver"],
      filhos: [
        { id: "board", rotulo: "Board", caminho: "/projetos/board", exigeAlguma: ["cp.negociacoes"] },
        { id: "lista", rotulo: "Lista", caminho: "/projetos/lista" },
        { id: "usuarios", rotulo: "Usuários e perfis", caminho: "/usuarios" },
        { id: "externo", rotulo: "Externo", caminho: "//fora" },
      ],
    },
    {
      id: "admin",
      rotulo: "Administração",
      caminho: "/configuracoes",
      filhos: [{ id: "config", rotulo: "Configurações", caminho: "/configuracoes", somenteAdministrador: true }],
    },
  ]);

  it("filtra os submenus pelas mesmas regras e leva o grupo a um submenu visível", () => {
    const m = montarMenu([cp], { administrador: false, permissoes: ["cp.ver"] });
    const projetos = m[0].itens.find((i) => i.id === "projetos")!;
    expect(projetos.filhos?.map((f) => f.id)).toEqual(["lista"]);
    expect(projetos.caminho).toBe("/projetos/lista");
    // grupo sem nenhum submenu visível some
    expect(m[0].itens.map((i) => i.id)).toEqual(["dashboard", "projetos"]);
  });

  it("administrador vê todos os submenus, menos os que o portal assume e os caminhos inválidos", () => {
    const m = montarMenu([cp], { administrador: true, permissoes: [] });
    expect(m[0].itens.find((i) => i.id === "projetos")!.filhos?.map((f) => f.id)).toEqual(["board", "lista"]);
    expect(m[0].itens.find((i) => i.id === "projetos")!.caminho).toBe("/projetos/board");
    expect(m[0].itens.find((i) => i.id === "admin")!.filhos?.map((f) => f.id)).toEqual(["config"]);
  });
});
