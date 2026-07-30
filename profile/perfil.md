# Perfil do candidato

Fonte única de fatos para o LLM preencher candidaturas e responder questionários.
Regra: se a resposta de uma pergunta não estiver aqui, o LLM NÃO responde (vira needs_review).

## Dados básicos

- Nome completo: Icaro David Melo de Freitas
- E-mail: icarodmelof@gmail.com
- Telefone: +55 85 99839-7705
- Cidade/UF: Fortaleza, CE
- LinkedIn: https://linkedin.com/in/icaromelo/
- GitHub: https://github.com/icaroMelo1

## Cargo e senioridade

- Cargo: Desenvolvedor Full Stack Sênior (forte em backend)
- Senioridade: Sênior (promovido tecnicamente na DSG pela qualidade e volume de entregas)

## Modalidade e disponibilidade

- Modalidade preferida: remoto
- Aceita presencial/híbrido: sim, em Fortaleza/CE; outras cidades são avaliadas caso a caso (não responder por outras cidades — deixar null)
- Regime: CLT ou PJ (ambos)
- CNH: sim (se a pergunta exigir a categoria, deixar null)
- Disponibilidade de início: imediata

## Remuneração

- Pretensão salarial: a partir de R$ 8.500 (CLT) ou a partir de R$ 9.000 (PJ); se a vaga não especificar o regime, responder "R$ 8.500 (CLT) ou R$ 9.000 (PJ), conforme o regime"
- Última/atual remuneração: R$ 7.500 (CLT)
- Instrução: nunca mencionar múltiplos vínculos simultâneos em respostas de questionário; para "remuneração atual", responder apenas "R$ 7.500 (CLT)"

## Experiência profissional

- Cast Group (Brasília, DF — remoto, CLT) — Desenvolvedor Full Stack Sênior — janeiro/2025 até hoje.
  Responsável único por 3 sistemas críticos do TJAM (Tribunal de Justiça do Amazonas): SGC (Gestão de
  Contratos), SGSA (Sistema de Senhas) e SISDOC (Gestão de Documentos). Observabilidade completa do zero
  (OpenTelemetry, Elastic APM, Prometheus, distributed tracing com correlation IDs). Agente de hardware
  cross-platform (Windows/macOS/Linux) para impressoras térmicas com Socket.IO empacotado como executável
  standalone. Sistema de filas customizado com DLQ, retry automático e workers concorrentes sem broker
  externo. Pipelines GitLab CI/CD completas (dev/hml/prd) com Kubernetes multi-réplica via APISIX +
  Rancher. Autenticação enterprise Keycloak + LDAP com roles granulares.
- DSG Technology (Criciúma, SC — remoto, PJ) — Desenvolvedor Full Stack Sênior — novembro/2024 até hoje.
  Plataforma de saúde corporativa com 9 microsserviços independentes (AWS SQS, Bull/Redis, WebSockets).
  Estruturou ecossistema de 7 agentes de IA especializados (1 orquestrador + 6 especialistas de domínio)
  com memória em dois níveis. Identificou e documentou race condition em produção com resolução via
  constraint de unicidade e idempotência. Referência interna em IA (sistemas multiagentes e orquestração
  de LLMs).
- iColabora (São Paulo, SP — remoto, PJ) — Desenvolvedor Full Stack Pleno / Tech Lead — agosto/2021 a
  outubro/2024. Otimizou queries críticas de 2-3 minutos para 10-15 segundos (indexação e reestruturação
  de JOINs em MySQL de alta carga). Filas assíncronas com RabbitMQ e Dead Letter Exchange. Tech Lead nos
  últimos 6 meses: 4 projetos simultâneos, code review, arquitetura, alinhamento com clientes, planning e
  deploys (GMUD). Suite de testes Cypress + Cucumber + Jest com cultura de BDD. Fluxos BPMN via ferramenta
  customizada (Turbina) com Java 8 e Node.js.

Observação: atua simultaneamente na Cast Group (CLT) e na DSG (PJ), ambas remotas.

## Stacks e experiência

- Linguagens: JavaScript, TypeScript (5 anos), Java 8
- Backend: Node.js (5 anos), NestJS, Feathers.js, Clean Architecture, DDD, microsserviços
- Frontend: Vue 2/3, Quasar, PrimeVue, Nuxt 3, React (5 anos no ecossistema Vue)
- Bancos/ORM: PostgreSQL, MySQL, PL/SQL, TypeORM, Sequelize, GraphQL, Gremlin
- Filas/Mensageria: RabbitMQ (DLX), AWS SQS, Bull/Redis, Dead Letter Queue, CRON consumers
- Auth/Segurança: Keycloak (SSO/OAuth2/OIDC), JWT, LDAP, API Keys
- Infra/DevOps: Docker, Kubernetes, GitLab CI/CD, Jenkins, Rancher, Portainer, APISIX
- Observabilidade: OpenTelemetry, Elastic APM, Prometheus, distributed tracing
- IA: Sistemas multiagentes, orquestração de LLMs, engenharia de prompts
- Testes: Jest, Cypress, Cucumber

## Formação e idiomas

- Tecnólogo em Análise e Desenvolvimento de Sistemas — UNIFOR (cursando, conclusão prevista em janeiro/2027)
- Engenharia Mecatrônica — IFCE (trancado)
- Desenvolvimento Web Full Stack — Trybe (certificado concluído)
- Inglês: B1 — leitura técnica avançada, conversação e escrita intermediárias
- Português: nativo

## Respostas padrão de questionário

- PCD: não (em perguntas opcionais sobre recursos de acessibilidade, responder com string vazia ou "Não se aplica")
- Já trabalhou na empresa antes: não
- Parentes na empresa: não
- Aceita política de privacidade/LGPD do processo: sim
- Principal fator ao se candidatar a uma vaga: crescimento profissional
- Perguntas de campo opcional que não se aplicam (matrícula de indicação, campo só para colaboradores da empresa): responder com string vazia

## Experiências específicas (para perguntas dissertativas de domínio)

- Chatbots / atendimento digital / bots: sim — na DSG atuo na plataforma de saúde que inclui assistente
  de IA via WhatsApp para agendamento e cobrança (orquestração de LLMs, sistemas multiagentes), além de
  notificações e atendimento em tempo real via WebSockets.
- Billing / cobrança: sim — fluxos automatizados de cobrança e pagamento (depósito antecipado) na
  plataforma da DSG, com filas, retries e conciliação de status de pagamento.
- Sistemas de gestão / backoffice: sim — gestão de contratos, documentos e filas de atendimento com
  senhas no TJAM (Cast Group), incluindo integrações entre sistemas e impressão térmica em tempo real.
- CRM: não tenho experiência direta com plataformas de CRM de mercado (Salesforce etc.); tenho com
  integrações e portais de autoatendimento próprios.
- E-commerce: não tenho experiência direta.
- Tecnologias que NÃO domino profissionalmente: C#/.NET, Golang, PHP, Python (além de scripts), Angular,
  Ruby, Flutter/mobile. Para "quantos anos/nível de experiência com <tecnologia dessas>": responder
  honestamente que não possuo experiência profissional com ela ("0 anos"/"não possuo"/nível básico,
  conforme as opções); quando o campo for dissertativo, complementar com a experiência equivalente mais
  próxima (ex: "não atuei com C#, mas tenho 5 anos de Node.js/TypeScript no backend").

## Resposta padrão — "maior desafio profissional" (adaptar ao contexto da pergunta)

Tenho 5 anos de experiência com desenvolvimento de produtos digitais. Meu desafio mais complexo recente
foi em uma plataforma de saúde corporativa com 9 microsserviços: identifiquei uma race condition em
produção que causava registros duplicados intermitentes, difícil de reproduzir. Documentei o caso com
evidências e timeline dos eventos e propus a resolução via constraint de unicidade no banco e
idempotência nos guards, eliminando a recorrência. Em paralelo, como responsável único por 3 sistemas
críticos de um tribunal de justiça, implementei observabilidade completa do zero (OpenTelemetry, Elastic
APM, Prometheus) — o que reduziu drasticamente o tempo de diagnóstico de incidentes — e um sistema de
filas com Dead Letter Queue e retry automático sem broker externo. Os principais resultados: sistemas
mais resilientes, diagnóstico rápido de problemas em produção e autonomia completa do design da
arquitetura ao deploy.
