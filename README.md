# MOBRIX

**ERP industrial para marcenarias.** O Mobrix centraliza gestão comercial, projetos, engenharia, materiais, compras, produção, qualidade, custos, manutenção e relacionamento com clientes em uma única plataforma.

O objetivo é conectar o que é vendido ao que é projetado, comprado, fabricado, conferido e entregue — com rastreabilidade por empresa e indicadores para apoiar decisões operacionais.

> Produto: **Mobrix**  
> Repositório: [alexssander-cristino/Mobrix](https://github.com/alexssander-cristino/Mobrix)  
> Branch principal: \`main\`

---

## Índice

- [Visão geral](#visão-geral)
- [Tecnologias](#tecnologias)
- [Módulos e funcionalidades](#módulos-e-funcionalidades)
- [Arquitetura do projeto](#arquitetura-do-projeto)
- [Requisitos](#requisitos)
- [Instalação local](#instalação-local)
- [Configuração de ambiente](#configuração-de-ambiente)
- [Banco de dados e migrações](#banco-de-dados-e-migrações)
- [Comandos disponíveis](#comandos-disponíveis)
- [API](#api)
- [Autenticação e segurança](#autenticação-e-segurança)
- [Portal e páginas públicas](#portal-e-páginas-públicas)
- [Privacidade e documentos legais](#privacidade-e-documentos-legais)
- [Deploy](#deploy)
- [Testes e validação](#testes-e-validação)
- [Limitações e observações técnicas](#limitações-e-observações-técnicas)
- [Estrutura de diretórios](#estrutura-de-diretórios)
- [Fluxo recomendado de uso](#fluxo-recomendado-de-uso)

---

## Visão geral

O Mobrix é um sistema web de gestão para empresas de marcenaria e fabricação de móveis sob medida.

A plataforma reúne:

- Gestão de empresas, usuários e clientes.
- Projetos, móveis, orçamentos e acompanhamento.
- Engenharia de peças e fichas técnicas.
- Materiais, estoque, retalhos e compras.
- Ordens, etapas e planejamento da produção.
- Apontamento de horas e produtividade.
- Custos, rentabilidade e indicadores gerenciais.
- Inspeções e controle de qualidade.
- Máquinas, manutenção e capacidade produtiva.
- Rastreabilidade por etiquetas e QR Code.
- Portal do cliente, aprovações e passaporte digital.
- Visualização de modelos 3D e recursos de realidade aumentada quando suportados pelo dispositivo.
- Recursos de automação operacional e telemetria IoT.

A interface utiliza identidade visual industrial escura, com tons de grafite, carvão e vermelho, e foi estruturada para desktop e dispositivos móveis.

---

## Tecnologias

### Backend

- **Node.js 20 ou superior**
- **Express 4**
- **PostgreSQL 16** (compatível com versões suportadas pelo projeto)
- **node-postgres (pg)** para acesso ao banco
- **JWT** para sessões autenticadas
- **bcryptjs** para hash de senhas
- **Helmet** para cabeçalhos HTTP
- **CORS** para controle de origens
- **dotenv** para variáveis de ambiente

### Frontend

- HTML5
- CSS3
- JavaScript
- Interface modular servida pelo Express
- SVG inline para ícones da navegação
- Visualizadores 3D baseados em GLB/GLTF e \`<model-viewer>\` nas áreas compatíveis

### Qualidade e automação

- npm scripts
- Node.js \`--check\` para validação sintática
- Testes automatizados do projeto
- Smoke tests HTTP
- GitHub Actions
- PostgreSQL de serviço no pipeline de CI

---

## Módulos e funcionalidades

A relação abaixo descreve os recursos presentes no código do projeto. Alguns recursos são estimativas operacionais e não substituem validação técnica, apontamento real ou integração específica com equipamentos.

### 1. Dashboard e Command Center

Painel gerencial com visão resumida da empresa e atalhos para as áreas de trabalho.

O **Mobrix Command Center** reúne:

- Ordens de produção com prazo vencido.
- Materiais no mínimo ou abaixo do estoque mínimo.
- Projetos aprovados que ainda não possuem ordem de produção.
- Orçamentos/propostas aguardando aprovação, conforme os dados disponíveis.
- Total de horas apontadas no mês.
- Quantidade de apontamentos e colaboradores com registros.
- Colaborador com maior volume de horas apontadas.
- Acessos rápidos para projetos, ordens, compras e análise gerencial.

Os alertas são montados a partir dos registros existentes no sistema. A ausência de alertas significa que nenhuma das condições monitoradas foi encontrada nos dados consultados; não representa uma auditoria automática de toda a operação.

### 2. Empresas, usuários e clientes

- Cadastro de empresa durante o registro inicial.
- Autenticação de usuários.
- Perfil administrativo inicial para a conta que cria a empresa.
- Ativação/desativação de usuários no controle de autenticação.
- Atualização dos dados da empresa e do perfil.
- Alteração de senha.
- Cadastro e consulta de clientes.
- Isolamento dos registros por empresa.

### 3. Projetos e gestão comercial

- Cadastro e acompanhamento de projetos.
- Associação de clientes.
- Status, prazo, descrição e informações comerciais.
- Preço de venda e custo estimado.
- Visão consolidada do projeto.
- Aprovação de projetos.
- Geração/integração com ordem de produção nos fluxos implementados.
- Histórico e eventos associados ao projeto.
- Levantamentos técnicos por ambiente.

### 4. Engenharia e ficha técnica

- Cadastro de peças vinculadas aos projetos.
- Dimensões, espessura, quantidade e sentido do veio.
- Lista técnica para apoiar fabricação e compras.
- Relação entre projeto, peças e materiais.
- Exportação de dados técnicos para fluxos de fabricação compatíveis.

### 5. Materiais, estoque e retalhos

- Cadastro de materiais e fornecedores.
- Quantidade disponível e estoque mínimo.
- Dimensões de chapas.
- Movimentações de entrada e saída.
- Histórico de movimentações.
- Validação transacional das operações de estoque.
- Cadastro e controle de retalhos.
- Situação de reaproveitamento dos retalhos.
- Reserva de materiais para projetos.
- Consumo e liberação de reservas.
- Planejamento de compras com aproveitamento de chapas e retalhos.
- Identificação de peças que não se encaixam no material disponível.
- Estimativa de chapas necessárias para compra.

### 6. Compras e fornecedores

- Planejamento de necessidades de compra.
- Ordens de compra.
- Itens de cada ordem.
- Recebimento de compras.
- Comparação de cotações de fornecedores.
- Consulta de preço, quantidade e prazo informado.
- Consideração de materiais já disponíveis e reservados no planejamento.

### 7. Produção e chão de fábrica

- Ordens de produção vinculadas aos projetos.
- Código, prioridade, etapa e prazo.
- Etapas produtivas e movimentação entre elas.
- Histórico de alterações de etapa.
- Painel de fábrica organizado por etapa.
- Fila de ordens priorizada por urgência e prazo.
- Indicadores de produção.
- Planejamento e capacidade por etapa.
- Agenda de produção editável.
- Simulação de capacidade e carga estimada.

### 8. Apontamento de tempo e produtividade

- Registro de horas por colaborador.
- Associação a projeto e operação.
- Consulta de apontamentos.
- Consolidação de horas por período.
- Indicadores de produtividade.
- Utilização do tempo apontado em análises de custo, conforme as informações cadastradas.

### 9. Mobrix Intelligence

Área de análise gerencial com indicadores calculados a partir dos dados da empresa:

- Custo interno por hora configurável.
- Resultado estimado por projeto.
- Margem estimada.
- Comparação entre preço de venda e custos considerados.
- Alertas de projetos com margem baixa.
- Alertas de estoque crítico e ordens atrasadas.
- Comparação de fornecedores cadastrados.
- Resumo de horas apontadas.

O custo por hora pode ser alterado por usuário com perfil administrativo. Os valores de rentabilidade dependem da qualidade dos custos, despesas e horas registrados.

### 10. Mobrix Quality

- Checklists de inspeção por etapa.
- Associação a projeto e, quando aplicável, ordem de produção.
- Resultado da inspeção: aprovado, ajustes ou reprovado.
- Registro de observações e evidências.
- Histórico de inspeções.
- Bloqueio de aprovação quando existem itens pendentes no checklist.
- Validação dos vínculos entre empresa, projeto, ordem e responsável.

### 11. Portal do cliente e aprovação

- Link individual para acompanhamento do projeto.
- QR Code para facilitar o acesso.
- Token aleatório com armazenamento somente do hash no banco.
- Validade configurada para links de acompanhamento.
- Revogação de links.
- Visualização pública limitada às informações permitidas.
- Fluxo de aprovação de projeto pelo cliente.
- Possibilidade de solicitar ajustes.
- Atualização do estado do projeto a partir da resposta do cliente.
- Geração de ordem de produção nos fluxos de aprovação previstos.

### 12. Mobrix Factory Intelligence

Conjunto de ferramentas para controle e análise da fábrica:

- **Flow:** ordens por etapa, capacidade diária configurada, carga estimada e alertas de gargalo.
- **Rastreabilidade:** etiquetas por peça, códigos individuais, QR Code e atualização de situação.
- **Custos reais:** consolidação de materiais, horas apontadas e despesas adicionais por projeto.
- **Aprovação:** links temporários para aprovação ou solicitação de ajustes pelo cliente.
- **CNC:** exportação de dados técnicos em CSV para adaptação ao fluxo do equipamento.
- **Compras preditivas:** estimativa de cobertura e reposição com base no histórico de consumo e compromissos.
- **Levantamento:** medidas por ambiente, portas, janelas, pontos elétricos e observações.
- **Copilot operacional:** recomendações determinísticas com base nos dados da empresa.

### 13. Mobrix Advanced Studio

- **Digital Twin operacional:** visão consolidada de setores, máquinas, ordens e inspeções.
- **Nesting:** otimização heurística de peças em chapas, considerando dimensões, perda de serra (kerf) e sentido do veio.
- **Visualização 3D/AR:** visualizador de modelos GLB/GLTF e abertura em recursos de realidade aumentada quando suportados pelo navegador/dispositivo.
- **Manutenção:** cadastro de máquinas, horas de operação, intervalos e registros de manutenção/parada.
- **Passaporte digital:** link público de consulta com token protegido por hash, garantia e possibilidade de revogação.
- **Planejamento automático:** sugestão inicial de sequência de ordens por prioridade e prazo, com agenda editável.
- **Inspeções:** checklists e registro de evidências.
- **Simulador financeiro:** cenários de preço, custo e margem.
- **Fornecedores:** registro e comparação de cotações.
- **Configurador paramétrico:** cadastro de configurações e estimativa inicial de peças, área e custo.

### 14. Mobrix Intelligent Factory

- **Autopilot:** recomendações operacionais para atrasos, estoque no mínimo, manutenção próxima, ordens sem agenda e telemetria fora dos limites definidos.
- **Engenharia reversa assistida:** registro de fotos de referência, dimensões e observações para revisão técnica.
- **Simulador de fábrica:** estimativa de carga, capacidade, utilização e prazo com parâmetros configuráveis.
- **Estoque por imagem:** registro fotográfico e conferência manual de materiais antes de movimentar o saldo.
- **Montagem guiada:** guias com etapas e acompanhamento de conclusão, com modelo 3D opcional.
- **IoT industrial:** cadastro de dispositivos, autenticação por segredo e ingestão de telemetria.
- **Colaboração:** comentários compartilhados por projeto.
- **Histórico vitalício:** linha do tempo de eventos do projeto e histórico com visibilidade pública controlada pelo passaporte.

### 15. Ferramentas legadas

O arquivo \`public/ferramentas-legadas.html\` mantém ferramentas anteriores de orçamento, precificação, prazo, plano de corte e visualização 3D.

**Atenção:** essas ferramentas legadas ainda utilizam armazenamento local do navegador em partes do fluxo. Elas não devem ser consideradas sincronizadas entre usuários ou dispositivos até que seus dados sejam migrados para a API e para o PostgreSQL.

---

## Arquitetura do projeto

O Mobrix utiliza uma aplicação Express que serve o frontend estático e disponibiliza a API REST.

\`\`\`text
Navegador
   |
   | HTML / CSS / JavaScript
   v
Express (server.js)
   |
   +---- Autenticação JWT
   |
   +---- Rotas principais
   |
   +---- advanced-routes.js
   |
   +---- innovation-routes.js
   |
   +---- advanced-studio-routes.js
   |
   +---- intelligent-factory-routes.js
   |
   v
PostgreSQL
   |
   +---- Empresas e usuários
   +---- Clientes e projetos
   +---- Materiais e estoque
   +---- Compras e reservas
   +---- Produção e apontamentos
   +---- Qualidade e portais
   +---- Studio e Intelligent Factory
\`\`\`

### Organização do código

- \`server.js\`: inicialização do Express, conexão PostgreSQL, autenticação, endpoints principais e entrega do frontend.
- \`advanced-routes.js\`: inteligência gerencial, fábrica, qualidade e portal do cliente.
- \`innovation-routes.js\`: capacidade, levantamentos, custos, rastreabilidade, CNC, previsão de suprimentos, aprovações e recomendações.
- \`advanced-studio-routes.js\`: máquinas, agenda, nesting, cotações, configurações, inspeções e passaporte digital.
- \`intelligent-factory-routes.js\`: Autopilot, engenharia reversa, showroom, simulações, estoque por imagem, montagem, IoT, colaboração e histórico.
- \`public/index.html\`: estrutura principal da aplicação.
- \`public/app.js\`: navegação e lógica principal da interface.
- \`public/styles.css\`: estilos globais e componentes da interface.
- \`public/advanced.js\`, \`public/innovation.js\`, \`public/advanced-studio.js\`, \`public/intelligent-factory.js\`: módulos de interface especializados.
- \`public/portal.html\`, \`public/approval.html\`, \`public/passport.html\`, \`public/showroom.html\`, \`public/trace.html\`: páginas públicas específicas.
- \`db/schema.sql\`: schema base do banco.
- \`db/migrations/\`: alterações incrementais do banco.
- \`db/migrate.js\`: executor de migrações.
- \`scripts/db-setup.js\`: preparação inicial do schema.
- \`scripts/ci-smoke-test.js\`: testes de integração/smoke test da API.

---

## Requisitos

Para executar o projeto localmente:

- Node.js **20 ou superior**.
- npm.
- PostgreSQL **16 recomendado**.
- Git.
- Acesso ao repositório.

Para recursos 3D/AR, é necessário um modelo GLB/GLTF acessível por HTTPS e um navegador/dispositivo compatível. A disponibilidade de AR depende do suporte do dispositivo e do navegador.

---

## Instalação local

### 1. Clonar o repositório

\`\`\`bash
git clone https://github.com/alexssander-cristino/Mobrix.git
cd Mobrix
\`\`\`

### 2. Instalar dependências

\`\`\`bash
npm install
\`\`\`

### 3. Criar o banco PostgreSQL

Crie um banco de dados vazio, por exemplo:

\`\`\`sql
CREATE DATABASE mobrix;
\`\`\`

### 4. Configurar o ambiente

Copie o arquivo de exemplo:

**Windows PowerShell**
\`\`\`powershell
Copy-Item .env.example .env
\`\`\`

**Linux/macOS**
\`\`\`bash
cp .env.example .env
\`\`\`

Edite o arquivo \`.env\` e informe os dados reais do banco e uma chave JWT segura.

### 5. Preparar o banco

\`\`\`bash
npm run db:setup
\`\`\`

Esse comando executa a preparação do schema base e aplica as migrações incrementais pendentes.

### 6. Iniciar o ambiente de desenvolvimento

\`\`\`bash
npm run dev
\`\`\`

O servidor ficará disponível em:

\`\`\`text
http://localhost:3000
\`\`\`

O script \`predev\` também executa \`npm run db:setup\` automaticamente antes do servidor de desenvolvimento.

### 7. Iniciar em modo de produção

\`\`\`bash
npm start
\`\`\`

---

## Configuração de ambiente

O arquivo \`.env.example\` contém as variáveis utilizadas na inicialização:

| Variável | Obrigatória | Descrição |
|---|---:|---|
| \`PORT\` | Não | Porta HTTP. Padrão recomendado: \`3000\`. |
| \`NODE_ENV\` | Sim | Ambiente de execução: \`development\`, \`test\` ou \`production\`. |
| \`DATABASE_URL\` | Sim | URL de conexão PostgreSQL. |
| \`JWT_SECRET\` | Sim | Segredo de assinatura dos tokens JWT. Deve possuir pelo menos 32 caracteres. |
| \`CORS_ORIGIN\` | Não | Origens permitidas, separadas por vírgula. |
| \`PUBLIC_URL\` | Recomendado | URL pública usada como referência para links compartilháveis. |

### Exemplo

\`\`\`env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:senha@localhost:5432/mobrix
JWT_SECRET=COLOQUE_UM_SEGREDO_ALEATORIO_COM_PELO_MENOS_32_CARACTERES
CORS_ORIGIN=http://localhost:3000
PUBLIC_URL=http://localhost:3000
\`\`\`

Gere um segredo aleatório com:

\`\`\`bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
\`\`\`

**Importante:**

- Nunca publique o arquivo \`.env\`.
- Não reutilize o segredo JWT entre ambientes de desenvolvimento e produção.
- Se a senha do PostgreSQL possuir caracteres especiais, codifique-os para uso em URL.
- Em produção, configure \`CORS_ORIGIN\` com os domínios reais da aplicação, separados por vírgula.
- Não utilize \`CORS_ORIGIN\` aberto em produção.
- Configure \`PUBLIC_URL\` com o domínio HTTPS definitivo.

---

## Banco de dados e migrações

O banco é PostgreSQL e utiliza isolamento por empresa. Os registros de negócio possuem vínculo com a empresa responsável, e as rotas autenticadas usam a empresa associada ao usuário da sessão.

### Preparação

\`\`\`bash
npm run db:setup
\`\`\`

### Aplicar somente migrações pendentes

\`\`\`bash
npm run db:migrate
\`\`\`

### Schema inicial

O schema base está em:

\`\`\`text
db/schema.sql
\`\`\`

### Migrações existentes

As migrações incrementais versionadas atualmente no repositório incluem:

- \`002_industrial_modules.sql\`
- \`003_smart_purchasing.sql\`
- \`003_workshop_suite.sql\`
- \`004_purchasing_reservations.sql\`
- \`005_factory_intelligence.sql\`
- \`006_advanced_studio.sql\`
- \`007_intelligent_factory.sql\`

O executor registra as migrações aplicadas para evitar reaplicação.

> **Banco com dados existentes:** faça backup antes de atualizar. Não apague tabelas ou recrie o banco para instalar uma versão nova. Use o mecanismo de migrações do projeto e valide o resultado em ambiente de homologação antes de produção.

### Verificação da conexão e estrutura

\`\`\`text
GET /api/health
\`\`\`

A rota verifica a conexão PostgreSQL e a presença das tabelas necessárias. Se o banco estiver conectado, mas a estrutura estiver incompleta, a API retorna HTTP 503 com a relação de tabelas ausentes e orienta executar \`npm run db:setup\`.

---

## Comandos disponíveis

| Comando | Finalidade |
|---|---|
| \`npm install\` | Instala as dependências. |
| \`npm run dev\` | Prepara o banco e inicia o servidor com Nodemon. |
| \`npm start\` | Inicia o servidor Node.js. |
| \`npm run check\` | Verifica sintaxe dos arquivos JavaScript principais. |
| \`npm test\` | Executa a verificação definida em \`npm run check\`. |
| \`npm run db:setup\` | Prepara o schema e aplica migrações pendentes. |
| \`npm run db:migrate\` | Aplica migrações pendentes. |
| \`node scripts/ci-smoke-test.js\` | Executa testes HTTP de integração da API. |

---

## API

A API utiliza JSON. Salvo as rotas públicas explicitamente indicadas, os endpoints de negócio exigem autenticação JWT.

### Autenticação e conta

| Método | Endpoint | Descrição |
|---|---|---|
| GET | \`/api/health\` | Saúde da API e estrutura do banco. |
| POST | \`/api/auth/register\` | Cria empresa e primeiro usuário administrador. |
| POST | \`/api/auth/login\` | Autentica usuário. |
| GET | \`/api/me\` | Retorna usuário e empresa da sessão. |
| PATCH | \`/api/settings/company\` | Atualiza dados da empresa (admin). |
| PATCH | \`/api/settings/profile\` | Atualiza perfil. |
| POST | \`/api/settings/password\` | Altera senha. |

### Recursos principais

| Método | Endpoint | Descrição |
|---|---|---|
| GET | \`/api/dashboard\` | Indicadores do dashboard. |
| GET / POST / PATCH | \`/api/customers\` | Clientes. |
| GET / POST / PATCH | \`/api/projects\` | Projetos. |
| GET / POST / PATCH | \`/api/orders\` | Ordens de produção. |
| GET / POST / PATCH | \`/api/materials\` | Materiais. |
| GET / POST / PATCH | \`/api/finance\` | Lançamentos financeiros. |
| POST | \`/api/stock/movement\` | Registra movimentação de estoque. |
| GET | \`/api/stock/movements\` | Consulta movimentações. |
| GET / POST / DELETE | \`/api/engineering/parts\` | Peças de engenharia. |
| GET / POST / PATCH | \`/api/offcuts\` | Retalhos. |
| GET / POST | \`/api/time-entries\` | Apontamentos de tempo. |
| GET | \`/api/production/metrics\` | Indicadores de produção. |
| PATCH | \`/api/orders/:id/stage\` | Atualiza etapa de uma ordem. |
| GET | \`/api/purchasing/plan\` | Planejamento de compras. |
| GET / POST | \`/api/purchase-orders\` | Ordens de compra. |
| POST | \`/api/purchase-orders/:id/receive\` | Recebe uma ordem de compra. |
| POST | \`/api/projects/:id/reserve-materials\` | Reserva materiais para projeto. |
| POST | \`/api/projects/:id/consume-materials\` | Registra consumo reservado. |
| POST | \`/api/projects/:id/release-reservations\` | Libera reservas. |

### Produção, inteligência e qualidade

| Método | Endpoint | Descrição |
|---|---|---|
| GET | \`/api/production/factory\` | Visão do chão de fábrica. |
| GET | \`/api/production/planning\` | Planejamento de produção. |
| GET | \`/api/intelligence/overview\` | Indicadores do Mobrix Intelligence. |
| PATCH | \`/api/settings/hourly-cost\` | Configura custo interno por hora (admin). |
| GET / POST | \`/api/quality/checks\` | Inspeções e checklists de qualidade. |

### Factory Intelligence

Prefixo principal: \`/api/innovation\`.

Inclui endpoints para:

- Visão geral e capacidade por etapa.
- Levantamentos e medições por projeto.
- Custos adicionais por projeto.
- Geração e atualização de etiquetas de rastreabilidade.
- Exportação de dados CNC em CSV.
- Previsão de suprimentos.
- Copilot operacional.
- Links de aprovação e respostas públicas.

### Advanced Studio

Prefixo principal: \`/api/studio\`.

Inclui endpoints para:

- Visão geral do estúdio.
- Cadastro e manutenção de máquinas.
- Logs de operação e manutenção.
- Agenda de produção e planejamento automático.
- Otimização e histórico de nesting.
- Cotações de fornecedores.
- Configurações paramétricas.
- Inspeções.
- Criação, consulta e revogação de passaportes digitais.
- Consulta pública de passaporte.

### Intelligent Factory

Prefixo principal: \`/api/intelligent\`.

Inclui endpoints para:

- Autopilot e atualização de recomendações.
- Engenharia reversa assistida.
- Showroom 3D e links públicos temporários.
- Simulações de capacidade.
- Conferências de estoque por foto e confirmação.
- Guias de montagem.
- Cadastro de dispositivos IoT e ingestão de telemetria.
- Comentários colaborativos.
- Histórico de eventos do projeto e consulta pública permitida.

### Autorização nas requisições

Após o login, envie o token recebido no cabeçalho:

\`\`\`http
Authorization: Bearer SEU_TOKEN_JWT
Content-Type: application/json
\`\`\`

O token tem validade de **7 dias**. Se estiver ausente, inválido ou expirado, a API retorna HTTP 401.

---

## Autenticação e segurança

O projeto implementa:

- Hash de senha com bcryptjs e fator de custo configurado no backend.
- JWT assinado com segredo de ambiente e expiração de sete dias.
- Validação do usuário ativo em cada requisição autenticada.
- Isolamento de dados pelo identificador da empresa.
- Consultas e validações de vínculo entre empresa, projeto, ordem, material e usuário em operações sensíveis.
- Transações PostgreSQL em operações que precisam manter consistência, como cadastro inicial e movimentações de estoque.
- Helmet para cabeçalhos HTTP.
- CORS configurável por variável de ambiente.
- Limite de payload JSON da API.
- Tokens públicos armazenados como hash em fluxos de portal, showroom e passaporte.
- Revogação e/ou expiração de links públicos nos recursos que oferecem esse controle.
- Respostas públicas reduzidas às informações destinadas ao cliente.
- Cabeçalho \`Cache-Control: no-store\` em consultas públicas sensíveis.

### Recomendações para produção

- Use HTTPS.
- Mantenha \`JWT_SECRET\` forte, privado e exclusivo por ambiente.
- Restrinja \`CORS_ORIGIN\` aos domínios oficiais.
- Utilize credenciais PostgreSQL com privilégios mínimos.
- Faça backups periódicos e teste a restauração.
- Não compartilhe tokens de dispositivos IoT ou links privados.
- Revogue links públicos quando não forem mais necessários.
- Monitore logs, erros HTTP e disponibilidade do banco.
- Faça atualizações de schema primeiro em homologação.

---

## Portal e páginas públicas

O projeto disponibiliza páginas específicas para fluxos que não exigem a navegação autenticada da área administrativa:

| Caminho | Finalidade |
|---|---|
| \`/cliente/:token\` | Portal de acompanhamento do cliente. |
| \`/aprovacao/:token\` | Página de aprovação ou solicitação de ajustes. |
| \`/passaporte/:token\` | Passaporte digital do projeto/produto. |
| \`/showroom/:token\` | Visualização pública temporária de modelo 3D. |
| \`/rastreio/:code\` | Consulta pública de etiqueta de rastreabilidade. |

O acesso e as informações exibidas dependem da validade do token/código e das regras implementadas para cada recurso.

---

## Privacidade e documentos legais

O sistema disponibiliza páginas públicas para transparência e atendimento relacionado à LGPD:

- `/privacidade.html`: Aviso de Privacidade e explicação dos papéis de controlador e operador.
- `/termos.html`: Termos de Uso da plataforma.
- `/cookies.html`: Política de Cookies e tecnologias locais de sessão/preferências.
- `/direitos-dados.html`: orientações para exercício dos direitos dos titulares.

Os links são exibidos na tela de autenticação. No cadastro, o usuário precisa aceitar os Termos de Uso e confirmar a leitura do Aviso de Privacidade. A versão dos documentos, data/hora, usuário, empresa, endereço IP e user-agent são registrados em `privacy_acceptances`, criada pela migração `008_privacy_compliance.sql`. A migração `009_privacy_requests.sql` cria o recebimento estruturado de solicitações de titulares pela página pública `/solicitacao-dados.html`; os pedidos ficam registrados na tabela `privacy_requests` para tratamento interno pelo responsável.

**Pendências obrigatórias antes de produção:** preencher nos documentos a identificação jurídica do responsável pelo Mobrix, CPF/CNPJ, endereço e canal de privacidade/contato; confirmar os fornecedores e regiões efetivamente utilizados na hospedagem, banco e armazenamento; revisar os prazos de retenção e os contratos com operadores; e validar o conteúdo com assessoria jurídica. Os campos marcados como `[PREENCHER]` não podem permanecer na versão publicada.

A empresa cliente é, em regra, controladora dos dados pessoais de seus próprios clientes, colaboradores e fornecedores inseridos no sistema. O Mobrix atua como operador dessas informações conforme as instruções e o contrato aplicável, sem prejuízo de atuar como controlador em operações próprias, como cadastro e segurança da conta.

---

## Deploy

O Mobrix pode ser hospedado em um serviço que suporte Node.js e tenha conectividade com PostgreSQL.

### Configurações necessárias

- **Build command:** não é necessário um processo de compilação separado para o frontend atual.
- **Install command:** \`npm install\` (ou \`npm ci\` quando o lockfile estiver sincronizado).
- **Start command:** \`npm start\`.
- **Node.js:** versão 20 ou superior.
- **Variáveis:** \`DATABASE_URL\`, \`JWT_SECRET\`, \`NODE_ENV\`, \`CORS_ORIGIN\`, \`PUBLIC_URL\` e, opcionalmente, \`PORT\`.

### Banco de produção

Antes de disponibilizar uma versão nova:

1. Faça backup do banco.
2. Configure as variáveis de ambiente no provedor.
3. Garanta que o serviço consiga acessar o PostgreSQL.
4. Execute \`npm run db:setup\` no ambiente de deploy ou em uma etapa controlada com acesso ao banco.
5. Verifique \`GET /api/health\`.
6. Faça login e valide os principais fluxos com uma conta de teste.

Não execute o schema inicial manualmente sobre um banco de produção sem compreender o conteúdo e o estado das migrações. Preserve os dados existentes.

### GitHub Actions

O workflow em \`.github/workflows/validate.yml\` executa validações em ambiente Ubuntu com PostgreSQL 16:

1. Checkout do repositório.
2. Configuração do Node.js 20.
3. Instalação de dependências.
4. Preparação do banco.
5. Execução de \`npm test\`.
6. Execução de \`scripts/ci-smoke-test.js\`.

---

## Testes e validação

Antes de enviar alterações:

\`\`\`bash
npm install
npm run db:setup
npm test
node scripts/ci-smoke-test.js
\`\`\`

O comando \`npm test\` executa as verificações sintáticas definidas em \`npm run check\`. O smoke test inicializa a API contra o banco configurado e valida fluxos HTTP importantes, incluindo autenticação, isolamento entre empresas e respostas esperadas.

Também é recomendado validar manualmente:

- Cadastro e login.
- Criação de cliente e projeto.
- Geração e atualização de ordem.
- Movimentação de estoque.
- Reserva e consumo de materiais.
- Apontamento de horas.
- Inspeção de qualidade.
- Portal e aprovação do cliente.
- Links públicos, revogação e expiração.
- Layout em desktop e dispositivos móveis.

---

## Limitações e observações técnicas

Para evitar interpretações incorretas sobre o que cada ferramenta entrega:

- **CNC:** o sistema exporta dados técnicos estruturados em CSV. Não gera G-code universal; o arquivo precisa ser adaptado ao pós-processador e ao fabricante da máquina.
- **Nesting:** a otimização implementada é heurística 2D. O resultado é uma sugestão de aproveitamento, não uma garantia de plano industrial ótimo.
- **AR/3D:** depende de modelos GLB/GLTF válidos, HTTPS e suporte do navegador/dispositivo. Nem todos os aparelhos oferecem a mesma experiência de realidade aumentada.
- **Engenharia reversa assistida:** registra imagens, dimensões e observações para análise humana; não deduz automaticamente medidas por inteligência artificial.
- **Inspeção visual:** organiza checklists e evidências fotográficas; não classifica defeitos automaticamente por visão computacional.
- **Simulador de fábrica:** produz estimativas com base nos parâmetros informados e premissas simplificadas. Não substitui um APS/MES com roteiros, setup, turnos e tempos reais detalhados.
- **Autopilot e Copilot operacional:** geram recomendações determinísticas com dados cadastrados; não são agentes generativos nem previsões infalíveis.
- **Estoque por imagem:** a foto é evidência de conferência. A movimentação só ocorre após confirmação explícita.
- **IoT:** exige sensores/dispositivos reais e integração de telemetria. Os limites genéricos de alerta precisam ser ajustados à máquina e ao processo.
- **Custos e margens:** dependem de custos, despesas, preço de venda e horas corretamente registrados.
- **Ferramentas legadas:** algumas funcionalidades de orçamento, precificação, prazo, corte e visualização mantidas em \`public/ferramentas-legadas.html\` ainda utilizam armazenamento local do navegador e não são sincronizadas com o banco.

---

## Estrutura de diretórios

\`\`\`text
Mobrix/
├── .github/
│   └── workflows/
│       └── validate.yml
├── db/
│   ├── migrations/
│   ├── migrate.js
│   └── schema.sql
├── public/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── advanced.js
│   ├── innovation.js
│   ├── advanced-studio.js
│   ├── intelligent-factory.js
│   ├── portal.html
│   ├── portal.js
│   ├── approval.html
│   ├── passport.html
│   ├── showroom.html
│   ├── trace.html
│   └── ferramentas-legadas.html
├── scripts/
│   ├── db-setup.js
│   ├── ci-db-setup.js
│   └── ci-smoke-test.js
├── advanced-routes.js
├── advanced-studio-routes.js
├── innovation-routes.js
├── intelligent-factory-routes.js
├── server.js
├── package.json
├── package-lock.json
├── .env.example
└── README.md
\`\`\`

---

## Fluxo recomendado de uso

Um fluxo operacional sugerido para a marcenaria:

1. Cadastre a empresa, os usuários e os clientes.
2. Registre o projeto e as informações comerciais.
3. Faça o levantamento técnico e cadastre as peças na engenharia.
4. Vincule materiais, chapas, ferragens e fornecedores.
5. Confira o estoque e planeje compras considerando retalhos disponíveis.
6. Reserve os materiais necessários para o projeto.
7. Aprove o projeto e gere/organize a ordem de produção.
8. Planeje a fila e distribua as ordens nas etapas da fábrica.
9. Registre horas, consumo de materiais e custos adicionais.
10. Realize inspeções de qualidade ao longo da fabricação.
11. Atualize a rastreabilidade e os registros de montagem.
12. Compartilhe o portal, a aprovação ou o passaporte digital com o cliente.
13. Acompanhe margem, produtividade, prazos e alertas no Command Center.

---

## Identidade do produto

- **Nome:** Mobrix
- **Categoria:** ERP e gestão industrial para marcenarias.
- **Estilo visual:** industrial, minimalista e responsivo.
- **Paleta principal:** vermelho, grafite e carvão.
- **Objetivo:** conectar gestão, engenharia, compras, produção e acompanhamento de projetos em uma única operação.

---

**Mobrix — gestão, engenharia e produção conectadas.**
