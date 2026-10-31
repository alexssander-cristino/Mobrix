# MOBRIX

ERP industrial para marcenarias. Gestão de projetos, produção, clientes, materiais e financeiro em um único ambiente.

## Stack

- Node.js 20+
- Express
- PostgreSQL
- HTML, CSS e JavaScript
- JWT para autenticação
- Isolamento de dados por empresa (`company_id`)

## Funcionalidades iniciais

- Cadastro de empresa e autenticação
- Dashboard com projetos ativos, ordens, estoque crítico e resumo financeiro
- Cadastro de clientes
- Projetos e móveis com custo, preço, prazo e status
- Ordens de produção com etapas, prioridade e avanço controlado com histórico
- Ficha técnica de peças por projeto (dimensões, espessura, quantidade e sentido do veio)
- Banco de retalhos com dimensões, material e situação de reaproveitamento
- Apontamento de tempo por colaborador, operação e projeto
- Indicadores de atraso, horas apontadas e área de retalhos disponíveis
- Materiais e saldo de estoque
- Movimentações de estoque com validação transacional
- Lançamentos de receitas e despesas
- Ferramentas originais de orçamento, precificação, prazo, plano de corte e visualização 3D preservadas em `public/ferramentas-legadas.html` (ainda com armazenamento local, até a migração específica desses módulos para PostgreSQL).
- Interface responsiva

## Executar localmente

1. Instale Node.js 20+ e PostgreSQL.
2. Crie um banco chamado `mobrix`.
3. Copie `.env.example` para `.env` e configure `DATABASE_URL` e `JWT_SECRET`.
4. Execute `db/schema.sql` no banco.
5. Instale dependências e inicie:

```bash
npm install
npm run dev
```

A aplicação ficará disponível em `http://localhost:3000`.

## API

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/me`
- `GET /api/dashboard`
- `GET|POST|PATCH /api/customers`
- `GET|POST|PATCH /api/projects`
- `GET|POST|PATCH /api/orders`
- `GET|POST|PATCH /api/materials`
- `GET|POST|PATCH /api/finance`
- `POST /api/stock/movement`
- `GET /api/stock/movements`
- `GET|POST|DELETE /api/engineering/parts`
- `GET|POST|PATCH /api/offcuts`
- `GET|POST /api/time-entries`
- `GET /api/production/metrics`
- `PATCH /api/orders/:id/stage`

Rotas de dados exigem `Authorization: Bearer <token>`.

## Deploy

Configure no provedor: Start `npm start`, `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production` e `CORS_ORIGIN`. Execute `db/schema.sql` no banco antes de abrir a aplicação.

## Próximas etapas

- Plano de corte otimizado e reaproveitamento de retalhos
- Ficha técnica por móvel e lista de peças
- Apontamento de tempo e produtividade por etapa
- Cálculo de custo real e margem por projeto
- Agenda de montagem, entrega e instalação
- Relatórios e exportação
- Perfis e permissões granulares
- Testes automatizados e migrações versionadas

> O schema inicial é uma base de produto e deve ser aplicado em um banco novo. Faça backup antes de aplicar alterações em ambientes existentes.