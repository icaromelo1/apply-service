# Deploy — VM Oracle

Stack do scraper (scraper-go + Valkey) rodando na VM Oracle em `~/apply-stack/`.

## Layout na VM

```
~/apply-stack/
├─ scraper-go/   # espelho rsync do Jobs_Scraper_Global/scraper-go
└─ deploy/       # espelho deste diretório (compose)
```

## Sincronizar e subir

```bash
./sync.sh                       # rsync scraper-go + deploy para a VM
ssh oracle-vm 'cd apply-stack/deploy && docker compose up -d --build'
```

Se o ssh via Tailscale travar pedindo re-auth, usar o IP público:
`ssh -o HostName=147.15.78.182 oracle-vm`.

## Validar

```bash
ssh oracle-vm 'curl -s http://127.0.0.1:8081/health'
ssh oracle-vm 'curl -s -X POST http://127.0.0.1:8081/scrape \
  -H "Content-Type: application/json" \
  -d "{\"keywords\":[\"node\"],\"maxPagesPerKeyword\":1,\"resultsPerPage\":10}"'
```

## Decisões

- Porta do scraper publicada apenas em loopback da VM: `127.0.0.1:8081` (estava
  livre na criação; conferir com `ss -tlnp` antes de mudar).
- Valkey sem porta publicada, só na rede `apply-net`, com
  `--maxmemory 256mb --maxmemory-policy allkeys-lru` — o cache nunca cresce além
  do teto (jobs/índices do scraper já têm TTL próprio).
- A VM é ARM64 (Ampere). Build do scraper é nativo (golang:1.26-alpine arm64).
- Playwright ARM64 validado na VM em 30/07/2026: imagem
  `mcr.microsoft.com/playwright:v1.54.0-noble` (aarch64) com Chromium 139
  funcionando — é a base para o container do apply-service.
- `rsync` foi instalado na VM via apt (não vinha na imagem).
- Nada do stack existente da VM (Traefik, Minecraft, DSG/pm2, Postgres) foi
  alterado; o stack é 100% aditivo.
