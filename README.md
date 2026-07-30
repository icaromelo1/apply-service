# apply-service

Serviço standalone de automação de candidaturas a vagas. Consome o scraper Go do
Jobs_Scraper_Global como sidecar HTTP (POST /scrape) e a API pública da Gupy,
ranqueia as vagas contra critérios pessoais, enfileira em SQLite e:

- **Greenhouse / Lever** — aplica automaticamente via Playwright (form público);
- **Gupy** — aplica em modo semi-automático (sessão persistida; questionário com
  resposta incerta vira `needs_review`, nunca chuta pergunta eliminatória);
- **LinkedIn / Indeed** — gera digest no Discord com cover letter pronta para
  aplicação manual em 1 clique.

Cover letters e respostas de questionário são geradas pela Claude API usando
exclusivamente os fatos de `profile/perfil.md`.

## Arquitetura

```
tick (cron 2-3x/dia)
  ├─ ingest/    scraper local (POST /scrape) + Gupy (API pública)
  ├─ pipeline/  score por criterios.json → fila (dedup, cooldown/empresa, teto diário)
  ├─ appliers/  greenhouse, lever (full-auto) · gupy (semi-auto)
  ├─ digest     LinkedIn/Indeed → webhook Discord
  └─ review     mini web UI para a fila needs_review
```

Estado em `data/apply.db` (SQLite + Drizzle). Descrição completa da vaga só é
mantida enquanto `queued`/`needs_review`; prune semanal apaga expirados e roda
VACUUM. Deploy na VM Oracle via `deploy/` (compose com scraper-go + Valkey com
maxmemory 256mb).

## Comandos

```bash
npm install
npm run db:push      # cria/atualiza data/apply.db
npm run typecheck
npm run tick         # ciclo completo: ingest → score → appliers → digest
```

## Configuração

- `profile/perfil.md` — fatos do candidato (fonte única do LLM)
- `profile/criterios.json` — keywords, senioridade, tetos e score mínimo
- `profile/curriculo.pdf` — currículo anexado nas candidaturas (não versionado)
- env: `SCRAPER_URL`, `GUPY_BASE_URL`, `ANTHROPIC_API_KEY`, `DISCORD_WEBHOOK_URL`
