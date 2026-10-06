/**
 * Gera o pacote de entrega: dist-pacote/portal-vX_Y_Z-AAAA-MM-DD.zip
 *   server.js (servidor + kit empacotados com esbuild), exportar-cronogramas.js (ferramenta da importação),
 *   public/ (tela do Vite), db/, package.json, node_modules/@electric-sql/pglite (banco embutido),
 *   iniciar.bat, iniciar.sh, .env.exemplo, CHANGELOG.md, LEIA-ME.txt
 * Quem só usa não precisa de npm install; exige Node 24.
 */
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
const nomeVersao = `portal-v${pkg.version.replace(/\./g, "_")}-${pkg.buildDate}`;
const saida = join(raiz, "dist-pacote");
const pasta = join(saida, nomeVersao);
const sh = (c, cwd = raiz) => execSync(c, { cwd, stdio: "inherit" });

console.log(`\n▶ Empacotando ${nomeVersao}\n`);
rmSync(pasta, { recursive: true, force: true });
mkdirSync(pasta, { recursive: true });

// 1) tela
sh("npm run build -w web");
cpSync(join(raiz, "dist", "public"), join(pasta, "public"), { recursive: true });

// 2) servidor e ferramenta (TypeScript + kit + fastify + pg num arquivo só; PGlite fica fora por causa do wasm)
const comum = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  external: ["@electric-sql/pglite", "pg-native"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: "none",
  logLevel: "warning",
};
await build({ ...comum, entryPoints: [join(raiz, "api", "src", "servidor.ts")], outfile: join(pasta, "server.js") });
await build({
  ...comum,
  entryPoints: [join(raiz, "ferramentas", "exportar-cronogramas.ts")],
  outfile: join(pasta, "exportar-cronogramas.js"),
});
cpSync(join(raiz, "node_modules", "@electric-sql", "pglite"), join(pasta, "node_modules", "@electric-sql", "pglite"), {
  recursive: true,
});

// 3) banco e textos
cpSync(join(raiz, "db"), join(pasta, "db"), { recursive: true });
rmSync(join(pasta, "db", "migracoes", ".gitkeep"), { force: true });
cpSync(join(raiz, "CHANGELOG.md"), join(pasta, "CHANGELOG.md"));
writeFileSync(
  join(pasta, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      buildDate: pkg.buildDate,
      private: true,
      type: "module",
      engines: pkg.engines,
      scripts: { start: "node server.js" },
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(join(pasta, ".env.exemplo"), readFileSync(join(raiz, ".env.example"), "utf8"));
writeFileSync(
  join(pasta, "iniciar.bat"),
  readFileSync(join(raiz, "empacotar", "iniciar.bat"), "utf8").replace(/\r?\n/g, "\r\n"),
);
writeFileSync(join(pasta, "iniciar.sh"), readFileSync(join(raiz, "empacotar", "iniciar.sh"), "utf8"), { mode: 0o755 });
writeFileSync(
  join(pasta, "LEIA-ME.txt"),
  `Portal da plataforma v${pkg.version} (${pkg.buildDate})

O portal faz o login, é dono dos usuários e perfis, monta o menu dos módulos e repassa cada acesso ao módulo
certo com o token da plataforma. Os módulos rodam com AUTH_MODO=portal e o MESMO SEGREDO_PLATAFORMA.

Uso local (Windows): duplo clique em iniciar.bat. Mac/Linux: ./iniciar.sh. Exige Node.js 24.
Na primeira vez o iniciar cria o .env (modo de teste: admin@portal.teste / teste123, segredo gerado na hora) e abre
http://localhost:3030. Copie o SEGREDO_PLATAFORMA do .env para os módulos e inicie cada um com AUTH_MODO=portal
(Cronogramas na 3232, Orçamentos na 3333, como em MODULOS).

Importar os usuários do Cronogramas (mesmos ids e senhas):
  node exportar-cronogramas.js --banco <DATABASE_URL do Cronogramas>
  node exportar-cronogramas.js --pasta <pasta dados do Cronogramas>   (feche o Cronogramas antes)
  depois: portal > Administração > Importar do Cronogramas (confira a prévia, importe e apague o arquivo).

Nuvem (Railway): NODE_ENV=production, DATABASE_URL, SEGREDO_PLATAFORMA (variável compartilhada do projeto),
MODULOS (endereços internos *.railway.internal), ADMIN_EMAIL, ADMIN_SENHA. Comando: node server.js.
Veja a seção "Atenção ao atualizar" do CHANGELOG.md.
`,
);

// 4) conferência: nenhum segredo nem exportação no pacote
for (const proibido of [".env", "dados"]) {
  if (existsSync(join(pasta, proibido))) throw new Error(`Arquivo proibido no pacote: ${proibido}`);
}

// 5) ZIP
const zip = join(saida, `${nomeVersao}.zip`);
rmSync(zip, { force: true });
sh(`zip -qr "${zip}" "${nomeVersao}"`, saida);
console.log(`\n✔ ${zip}\n`);
