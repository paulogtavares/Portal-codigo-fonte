@echo off
chcp 65001 >nul
title Portal da plataforma
cd /d "%~dp0"
echo.
echo   ============================================
echo    Portal da plataforma
echo   ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   ERRO: Node.js nao encontrado. Instale a versao 24 em https://nodejs.org
  echo.
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if not "%NODEMAJOR%"=="24" (
  echo   ERRO: este pacote exige Node.js 24 ^(encontrado: %NODEMAJOR%^). Baixe em https://nodejs.org
  echo.
  pause
  exit /b 1
)

rem Primeira vez: cria o .env a partir do exemplo, com um SEGREDO_PLATAFORMA novo
if not exist ".env" (
  node -e "const f=require('fs');const s=require('crypto').randomBytes(32).toString('base64url');f.writeFileSync('.env',f.readFileSync('.env.exemplo','utf8').replace(/^SEGREDO_PLATAFORMA=.*$/m,'SEGREDO_PLATAFORMA='+s))"
  echo   Criado o arquivo .env ^(configuracao local^).
  echo   - Entre com admin@portal.teste e a senha teste123 ^(usuarios de teste^).
  echo   - Use nos modulos ^(AUTH_MODO=portal^) o mesmo SEGREDO_PLATAFORMA do .env.
  echo.
)

echo   O navegador abre sozinho quando o servidor estiver pronto.
echo   NAO feche esta janela enquanto estiver usando. Para parar: Ctrl+C
echo.
set ABRIR_NAVEGADOR=1
node --env-file=.env server.js
pause
