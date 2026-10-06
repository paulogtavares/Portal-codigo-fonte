# Portal da plataforma · histórico de versões

## 1.0.0-alpha.3 (2026-10-06) · cliente nasce sem acesso

Decisão de 06/10/2026: o usuário de cliente nunca nasce com cronograma, módulo ou valores disponíveis; o acesso é
marcado explicitamente.

- A importação do Cronogramas não dá mais `cronogramas.ver` aos perfis de cliente (só aos internos, quando a permissão
  existir no Cronogramas v2.2.0). Perfis de cliente entram sem nenhum módulo, e a prévia avisa quais são.
- Confirmado por teste: a cliente importada entra no portal sem nenhum módulo no menu. Usuário novo sempre exige a
  escolha de um perfil pelo administrador (regra do kit).

## 1.0.0-alpha.2 (2026-10-06) · ajustes da revisão de 06/10

Kit **plataforma-kit 1.6.0** (pedido deste portal). Ajustes apontados na validação independente e na revisão do
código-fonte (conversa de coordenação):

- **Permissões novas sem reiniciar.** A administração de usuários e perfis lê o catálogo agregado a cada requisição
  (kit 1.6.0): as permissões que um módulo ganha numa versão nova (ex.: `orcamentos.clientes.*` do Orçamentos v2.1.0)
  aparecem nos perfis assim que o portal relê o manifesto (até 1 minuto, ou "Verificar agora" na tela Módulos). Saiu o
  aviso "reinicie o portal". Perfis aceitam até 200 permissões.
- **Menu por área.** O campo `grupo` do manifesto (kit 1.6.0) reúne módulos sob um título: o Orçamentos v2.1.0
  (`"grupo": "Financeiro"`) aparece em **Financeiro**, onde depois entra o DRE; módulo sem grupo segue com o próprio
  nome. A tela Módulos mostra a área.
- **Contas de teste do Cronogramas na importação.** Conta com e-mail de teste do Cronogramas ou com a senha `teste123`
  entra, em produção, inativa, sem senha e sem administrador; no computador entra normalmente, com aviso. A prévia e o
  resumo listam essas contas, e a auditoria de contas de teste do portal passa a conhecer os e-mails de teste do
  Cronogramas.
- **`trustProxy` só no proxy da frente.** Antes o Fastify confiava em qualquer `X-Forwarded-For` (o navegador podia
  inventar o IP e contornar o limite de tentativas de login por IP); agora confia só no proxy imediato (Railway).
- **Conferência de origem.** Requisições que alteram dados (tudo menos GET, HEAD e OPTIONS), na API do portal e no
  repasse aos módulos, só são aceitas da própria origem (`Sec-Fetch-Site: same-origin` ou `Origin` do próprio portal);
  reforço ao `SameSite=Lax`.

### Atenção ao atualizar

- Publique o **kit 1.6.0** no GitHub (tag `v1.6.0`) antes de rodar `npm ci` neste código-fonte: o `package-lock.json`
  aponta para o commit da tag.

## 1.0.0-alpha.1 (2026-10-05) · Plano 4, etapas 0 a 6

Primeira versão do portal: a porta única da plataforma. Faz o login, é dono dos usuários e perfis, monta o menu a
partir dos manifestos dos módulos e repassa cada acesso ao módulo certo com o token da plataforma. Kit
**plataforma-kit 1.5.1**, instalado do GitHub pela tag (`e1f997d`), sem nenhuma mudança no kit.

**Etapa 0 · marco inicial.** Estrutura padrão (`api`, `web`, workspaces), Node 24, TypeScript estrito/ESM, Fastify 5,
React 19, React Router 7, Vite, TanStack Query, ESLint e Prettier do kit, Vitest.

**Etapa 1 · identidade.** `identidade.sql` do kit no schema `portal` (tabelas idênticas às do kit, conferidas por
teste no PGlite e no PostgreSQL 16); a única chave própria é `usuarios.cliente_id → clientes`. Login do kit no modo
local com o cookie `portal_sessao` (HttpOnly, SameSite=Lax, Secure em produção). Primeiro administrador por
`ADMIN_EMAIL` e `ADMIN_SENHA`, com troca de senha no primeiro acesso. Usuários de teste só com `MODO_TESTE=1`, ignorado
em nuvem. `AUTH_MODO` é ignorado no portal (é variável dos módulos).
Perfis com visões por módulo: o catálogo agregado (`lerCatalogoAgregado` do kit) junta as permissões do portal
(`portal.interno`, `portal.modulos.ver`) e as de cada módulo, e a tela de usuários e perfis do kit mostra uma seção
por módulo ("Ativar visão de …").

**Etapa 2 · registro de módulos.** Variável `MODULOS` (`id=url` ou `id@/prefixo=url`). O portal lê o `/modulo.json`
e o `/api/saude` de cada módulo ao iniciar e a cada minuto, e guarda o último manifesto em `portal.modulos`: um módulo
fora do ar continua no menu (marcado) e no catálogo. O prefixo vem do manifesto (ou da variável); `/api`, `/m`,
`/admin` e `/assets` são reservados.

**Etapa 3 · proxy.** Repasse por prefixo, com `X-Forwarded-Prefix` e um `X-Plataforma-Token` novo a cada requisição
(`aud` = id do módulo, só as permissões dele, validade de 60 s). O cookie do portal nunca é repassado (nenhum cookie
vai aos módulos), cabeçalhos de token, prefixo e autorização vindos do navegador são descartados, o `Set-Cookie` dos
módulos é descartado (nenhum módulo grava ou apaga o cookie do portal) e o `Location` é ajustado ao prefixo. O
corpo segue em fluxo. Recusas: sem sessão (401, com página que avisa o portal), perfil sem visão do módulo (403),
módulo em modo local (409), módulo fora do ar (502/504), caminho com `..` (400), sem `SEGREDO_PLATAFORMA` (503; em
nuvem o portal nem sobe). Quem abre o endereço de um módulo direto no navegador vai para a mesma tela dentro do
portal (`/m/<módulo>/…`).

**Etapa 4 · casca.** Barra superior do kit (usuário, tema, sair) e menu lateral montado dos manifestos, filtrado
pelas visões do perfil. Um iframe por módulo, mantido aberto ao trocar de módulo. A URL do portal acompanha o módulo
(`rota-alterada` → `/m/<módulo><caminho>`, sem recarregar o iframe; o menu usa `navegar`), e recarregar, voltar e
avançar mantêm a tela. O tema (claro, escuro, sistema) vai para os módulos pela mensagem `tema`. `sessao-expirada`:
se a sessão do portal acabou, volta ao login; se não, o módulo é aberto de novo uma vez.

**Etapa 5 · administração.** Usuários e perfis do portal (tela e rotas do kit; cliente do usuário externo escolhido
na lista de clientes de referência). Importação dos usuários do Cronogramas: ferramenta `exportar-cronogramas.js`
(lê o banco do Cronogramas, schema `cronogramas` ou `public`) e tela com prévia exata (a importação roda numa
transação desfeita). Mantém os ids de clientes, perfis e usuários; converte os perfis (prefixo do kit,
`portal.interno` pela visão interna); cada pessoa entra no portal com a senha que já usa no Cronogramas; reconcilia
por e-mail quem já existia no portal (o usuário passa a ter o id do Cronogramas, com a sessão aberta); reimportar
não duplica, não desfaz senha trocada no portal e mantém as permissões de outros módulos.

**Etapa 6 · saúde.** Tela Módulos: versão, situação e tempo de resposta, modo de login, prefixo, endereço interno
(só administrador) e de onde veio o manifesto; "Verificar agora"; aviso quando o catálogo de permissões mudou desde
que o portal iniciou.

### Pontos em aberto

- **Perfis sem permissão do Cronogramas** (como "Cliente") não veem o Cronogramas no portal, pela regra das visões.
  Pedido ao Cronogramas v2.2.0: uma permissão de acesso `cronogramas.ver`, dada a todos os perfis. A importação já a
  acrescenta assim que ela existir no catálogo.
- **Pedido ao kit (1.6.0):** `rotasAdministracao` com catálogo lido a cada requisição. Hoje o catálogo dos perfis é o
  do momento em que o portal iniciou; permissões novas de um módulo exigem reiniciar o portal (a tela Módulos avisa).
- **Clientes:** cópia de referência, preenchida pela importação do Cronogramas. O cadastro mestre é o do Orçamentos
  v2.1.0; a sincronização entra quando ele existir.

### Atenção ao atualizar

- `SEGREDO_PLATAFORMA` precisa ser o mesmo no portal e em todos os módulos (no Railway, variável compartilhada).
- Os módulos atrás do portal rodam com `AUTH_MODO=portal`; módulo em modo local não aparece no menu.
- O arquivo da exportação do Cronogramas traz o hash das senhas: apague-o depois de importar.
