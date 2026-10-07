# Portal da plataforma

Porta única da plataforma Infracommerce (kit plataforma-kit 1.6.0): login, usuários e perfis, menu dos módulos (Cronogramas, Orçamentos, C.P)
e repasse com o token da plataforma. Plano 4 do "Plano de equalização tecnológica".

```bash
npm ci                  # instala (o kit vem do GitHub pela tag; quem usa só HTTPS: git config --global url."https://github.com/".insteadOf "ssh://git@github.com/")
cp .env.example .env    # ajuste SEGREDO_PLATAFORMA e MODULOS
npm run dev             # API em 3030 (node roda o TypeScript direto) e Vite em 5173
npm test                # Vitest (PGlite em memória, módulos de teste com o kit no modo portal)
npm run test:postgres   # os testes da API num PostgreSQL de verdade: TESTE_DATABASE_URL=postgres://...
npm run typecheck && npm run lint && npm run formatacao
npm run empacotar       # dist-pacote/portal-vX_Y_Z-AAAA-MM-DD.zip
```

| Variável                                        | Uso                                                    |
| ----------------------------------------------- | ------------------------------------------------------ |
| `PORT`                                          | 3030                                                   |
| `NODE_ENV`, `DATABASE_URL`, `DADOS_DIR`, `HOST` | como nos módulos                                       |
| `COOKIE_SESSAO`                                 | `portal_sessao`                                        |
| `SEGREDO_PLATAFORMA`                            | assina os tokens; o mesmo nos módulos (32+ caracteres) |
| `MODULOS`                                       | `id=url` ou `id@/prefixo=url`, separados por vírgula   |
| `ADMIN_EMAIL`, `ADMIN_SENHA`, `ADMIN_NOME`      | primeiro administrador                                 |
| `MODO_TESTE`                                    | `1` libera os usuários de teste (ignorado em nuvem)    |

Rotas próprias: `/api/portal/menu`, `/api/portal/modulos`, `/api/portal/clientes`, `/api/portal/importacao/cronogramas`,
`/api/portal/importacoes`; o resto (`/api/auth/*`, `/api/eu`, `/api/admin/*`, `/api/status`, `/api/saude`) vem do kit.
Telas: `/`, `/m/<módulo>/<caminho>`, `/admin/usuarios`, `/admin/modulos`, `/admin/importacao`.
"# Portal-codigo-fonte"  
