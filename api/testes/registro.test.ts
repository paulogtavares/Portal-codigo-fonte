/** Registro de módulos (etapa 2): variável MODULOS, manifestos vivos e guardados, saúde e prefixos. */
import { afterAll, describe, expect, it } from "vitest";
import { lerRegistro, prefixoValido } from "../src/modulos.ts";
import { bancoNovo, entrar, montarPortal, subirModulo } from "./apoio.ts";

describe("variável MODULOS", () => {
  it("lê id=url e id@/prefixo=url, separados por vírgula, ponto e vírgula ou linha", () => {
    expect(
      lerRegistro(
        " cronogramas=http://127.0.0.1:3232/ ;orcamentos@/financeiro/orcamentos/=http://orc.railway.internal:8080\ncp=https://cp:1",
      ),
    ).toEqual([
      { id: "cronogramas", url: "http://127.0.0.1:3232", prefixo: undefined },
      { id: "orcamentos", url: "http://orc.railway.internal:8080", prefixo: "/financeiro/orcamentos" },
      { id: "cp", url: "https://cp:1", prefixo: undefined },
    ]);
    expect(lerRegistro(undefined)).toEqual([]);
  });

  it("recusa ao iniciar: formato, id, endereço, repetido, o próprio portal e prefixo reservado", () => {
    expect(() => lerRegistro("cronogramas")).toThrow(/formato/);
    expect(() => lerRegistro("Cronogramas=http://x")).toThrow(/id de módulo/);
    expect(() => lerRegistro("cp=ftp://x")).toThrow(/http/);
    expect(() => lerRegistro("cp=não é url")).toThrow(/endereço inválido/);
    expect(() => lerRegistro("cp=http://a,cp=http://b")).toThrow(/duas vezes/);
    expect(() => lerRegistro("portal=http://a")).toThrow(/próprio portal/);
    expect(() => lerRegistro("cp@/api=http://a")).toThrow(/reservado/);
    expect(() => lerRegistro("cp@/admin/x=http://a")).toThrow(/reservado/);
  });

  it("prefixos reservados às telas e à API do portal não valem", () => {
    for (const p of ["/", "/api", "/m", "/admin", "/assets/x", "/a b"]) expect(prefixoValido(p), p).toBeNull();
    expect(prefixoValido("/cronogramas/")).toBe("/cronogramas");
  });
});

describe("manifestos e saúde", () => {
  const abertos: { fechar(): Promise<void> }[] = [];
  afterAll(async () => {
    for (const a of abertos) await a.fechar().catch(() => {});
  });

  it("prefixo do manifesto, saúde e o mais longo vencendo", async () => {
    const orc = await subirModulo({ id: "orcamentos", prefixo: "/financeiro/orcamentos" });
    const fin = await subirModulo({ id: "financeiro", prefixo: "/financeiro" });
    abertos.push(orc, fin);
    const p = await montarPortal({ modulos: [orc, fin] });
    expect(p.registro.porCaminho("/financeiro/orcamentos/api/x")?.estado.id).toBe("orcamentos");
    expect(p.registro.porCaminho("/financeiro/orcamentos")?.resto).toBe("/");
    expect(p.registro.porCaminho("/financeiro/outra")?.estado.id).toBe("financeiro");
    expect(p.registro.porCaminho("/financeiroX")).toBeNull();
    const e = p.registro.obter("orcamentos")!;
    expect(e.saude?.ok).toBe(true);
    expect(e.fonteManifesto).toBe("ao-vivo");
    expect(e.origemPrefixo).toBe("manifesto");
    await p.app.close();
  });

  it("módulo fora do ar: o portal sobe com o manifesto guardado (menu e catálogo continuam)", async () => {
    const banco = await bancoNovo();
    const cron = await subirModulo({ id: "cronogramas" });
    const p1 = await montarPortal({ banco, modulos: [cron] });
    await p1.app.close();
    await cron.fechar();
    const p2 = await montarPortal({ banco, modulos: [cron] });
    const e = p2.registro.obter("cronogramas")!;
    expect(e.saude?.ok).toBe(false);
    expect(e.fonteManifesto).toBe("guardado");
    expect(e.manifesto?.permissoes.map((x) => x.chave)).toEqual(["cronogramas.ver", "cronogramas.editar"]);
    const c = await entrar(p2.app, "admin@portal.teste");
    const menu = (await p2.app.inject({ url: "/api/portal/menu", headers: { cookie: c } })).json();
    expect(menu[0]).toMatchObject({ id: "cronogramas", noAr: false });
    const perms = (await p2.app.inject({ url: "/api/admin/permissoes", headers: { cookie: c } })).json();
    expect(perms.map((x: any) => x.chave)).toContain("cronogramas.editar");
    await p2.app.close();
  });

  it("um módulo que nunca respondeu não derruba o portal", async () => {
    const p = await montarPortal({ env: { MODULOS: "cp=http://127.0.0.1:1" } });
    const e = p.registro.obter("cp")!;
    expect(e.manifesto).toBeNull();
    expect(e.prefixo).toBe("/cp");
    expect(p.logs.some((l) => l.includes("cp") && l.includes("fora do ar"))).toBe(true);
    await p.app.close();
  });
});

describe("releitura", () => {
  it("módulo que sobe depois do portal entra sozinho (nova tentativa em poucos segundos)", async () => {
    const tarde = await subirModulo({ id: "orcamentos", prefixo: "/financeiro/orcamentos" });
    const url = tarde.url;
    await tarde.fechar();
    const p = await montarPortal({ env: { MODULOS: `orcamentos=${url}` } });
    expect(p.registro.obter("orcamentos")!.prefixo).toBe("/orcamentos");
    const porta = Number(new URL(url).port);
    const subiu = await subirModulo({ id: "orcamentos", prefixo: "/financeiro/orcamentos", porta });
    p.registro.iniciar(300);
    await new Promise((r) => setTimeout(r, 900));
    expect(p.registro.obter("orcamentos")!.prefixo).toBe("/financeiro/orcamentos");
    p.registro.parar();
    await p.app.close();
    await subiu.fechar();
  });
});
