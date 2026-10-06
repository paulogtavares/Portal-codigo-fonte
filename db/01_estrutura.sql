-- =====================================================================
-- Portal da plataforma · estrutura inicial (schema portal)
-- As tabelas de identidade (perfis, usuarios, sessoes) vêm do kit
-- (plataforma-kit/identidade.sql) e são aplicadas ANTES deste arquivo.
-- Sem schema fixo: tudo cai no schema portal pelo search_path da conexão.
-- =====================================================================

-- Clientes ------------------------------------------------------------
-- Cópia de referência para os usuários externos (cliente_id). O cadastro
-- mestre é o do Financeiro / Orçamentos (v2.1.0); até lá, os clientes
-- chegam pela importação do Cronogramas, com os mesmos ids.
CREATE TABLE clientes (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome           text NOT NULL,
    documento      text,
    ativo          boolean NOT NULL DEFAULT true,
    origem         text NOT NULL DEFAULT 'cronogramas',
    criado_em      timestamptz NOT NULL DEFAULT now(),
    atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tg_clientes_atualizado BEFORE UPDATE ON clientes
    FOR EACH ROW EXECUTE FUNCTION fn_tg_atualizado_em();

-- usuário externo aponta para um cliente (chave própria do portal, como no Cronogramas)
ALTER TABLE usuarios
    ADD CONSTRAINT fk_usuarios_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE SET NULL;

-- Módulos -------------------------------------------------------------
-- O registro (id e endereço interno) vem da variável MODULOS. Aqui fica o
-- último manifesto lido de cada um: o menu e o catálogo de permissões
-- continuam disponíveis quando um módulo está fora do ar.
CREATE TABLE modulos (
    id             text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*$'),
    manifesto      jsonb NOT NULL,
    lido_em        timestamptz NOT NULL DEFAULT now()
);

-- Importações ---------------------------------------------------------
-- Histórico das importações de usuários (ex.: Cronogramas), com o resumo.
CREATE TABLE importacoes (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    origem         text NOT NULL,
    resumo         jsonb NOT NULL,
    feita_por      uuid REFERENCES usuarios (id) ON DELETE SET NULL,
    feita_em       timestamptz NOT NULL DEFAULT now()
);
