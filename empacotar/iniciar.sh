#!/usr/bin/env sh
# Portal da plataforma (Mac/Linux)
cd "$(dirname "$0")"
v=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null) || { echo "Node.js não encontrado. Instale a versão 24 em https://nodejs.org"; exit 1; }
[ "$v" = "24" ] || { echo "Este pacote exige Node.js 24 (encontrado: $v)."; exit 1; }

# Primeira vez: cria o .env a partir do exemplo, com um SEGREDO_PLATAFORMA novo
if [ ! -f .env ]; then
  segredo=$(node -p "require('crypto').randomBytes(32).toString('base64url')")
  sed "s/^SEGREDO_PLATAFORMA=.*/SEGREDO_PLATAFORMA=$segredo/" .env.exemplo > .env
  echo "Criado o arquivo .env (configuração local)."
  echo "- Entre com admin@portal.teste e a senha teste123 (usuários de teste)."
  echo "- Use nos módulos (AUTH_MODO=portal) o mesmo SEGREDO_PLATAFORMA do .env."
  echo
fi

echo "O navegador abre sozinho quando o servidor estiver pronto. (Ctrl+C para parar)"
export ABRIR_NAVEGADOR=1
exec node --env-file=.env server.js
