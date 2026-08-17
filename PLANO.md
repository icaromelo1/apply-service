# apply-service — Plano dos próximos passos

> Estado em 01/08/2026: 76 candidaturas enviadas na Gupy (170 empresas cobertas, fonte essencialmente
> esgotada), resolvedor de etapas ativo, custo zerado via Antigravity CLI, painel de revisão no ar.
> O gargalo deixou de ser **volume** e passou a ser **conversão** e **novas fontes**.

---

## Fase 0 — Fechar o que está aberto (pré-requisito de tudo)

**Por que primeiro:** são candidaturas já enviadas travando em etapa; cada dia parado é prazo correndo.

1. Concluir o reprocessamento dos formulários travados com o fix de layout agnóstico.
2. Preencher as lacunas de dados que só o Icaro tem: cidade/estado de nascimento, endereço/CEP,
   PIS/NIT, título de eleitor, dados bancários. Guardar apenas local + VM (nunca no git).
3. Decidir sobre **regime cooperativa** (apareceu na Viaflow e é comum em vaga remota): aceita? Com
   qual pretensão?
4. Varrer os `needs_review` restantes e classificar: recuperável por código vs. exige ação humana.

**Pronto quando:** zero candidatura parada por causa evitável; a fila de revisão só tem teste técnico,
entrevista e case.

---

## Fase 1 — Auditoria e reconstrução do perfil Gupy

**Por que:** na Gupy a triagem é feita pela GAIA comparando a **descrição da vaga com o seu perfil** —
não com o PDF. Um perfil incompleto derruba o match mesmo com currículo bom. É o único item que
melhora retroativamente as 76 candidaturas já enviadas.

1. Extrair o estado atual do perfil (`portal.gupy.io/curriculum`) com a sessão já autenticada:
   resumo, experiências, formação, competências, idiomas, pretensão, disponibilidade.
2. Relatório de lacunas contra o `perfil.md` (que já tem o retrato real e completo).
3. Preencher o que for objetivo e verificável, com as palavras-chave que aparecem nas vagas-alvo
   (Node.js, NestJS, TypeScript, microsserviços, AWS, Kubernetes, observabilidade, Vue).
4. Revisar o texto do resumo profissional para refletir **Sênior** (o perfil ainda pode dizer Pleno).

**Pronto quando:** perfil 100% completo e alinhado ao `perfil.md`, revisado pelo Icaro antes de salvar.

---

## Fase 2 — Novas fontes (onde está o próximo volume)

**Por que:** a Gupy está esgotada. Greenhouse e Lever **já têm applier construído e nunca foram
exercitados** — é a maior alavanca não usada, e são formulários públicos, sem risco de conta.

1. Ativar e validar os appliers de Greenhouse e Lever com as vagas que o scraper já coleta.
2. Adicionar ingest de **Workable** e **Ashby** (mesmo padrão de formulário público).
3. Avaliar **RemoteOK / WeWorkRemotely** como fonte de vagas internacionais.
4. Reavaliar o LinkedIn: manter só digest (risco de banimento não compensa automatizar).

**Pronto quando:** pelo menos uma candidatura confirmada em Greenhouse e uma em Lever, com evidência.

---

## Fase 3 — Currículo dinâmico com aderência a ATS

**Por que:** hoje todas as vagas recebem o mesmo PDF. Aderência textual é o que a maioria dos ATS
pontua.

1. `profile/cv-base.json` — fonte estruturada (experiências, bullets, skills), derivada do `perfil.md`
   e dos scripts `gerar_cv_*.py` já existentes.
2. `src/cv/select.ts` — dada a descrição da vaga, escolhe e reordena experiências, bullets, título e
   skills a destacar.
3. `src/cv/render.ts` — gera PDF **ATS-safe**: uma coluna, sem tabela/ícone/caixa de texto, fontes
   padrão, datas MM/AAAA, seções convencionais, texto selecionável.
4. `src/cv/score.ts` — mede cobertura dos requisitos da vaga pelo CV gerado; abaixo de ~75% é sinal de
   vaga pouco aderente (não aplicar) em vez de forçar.
5. Escolher variante por regime: `curriculo-clt.pdf` vs `curriculo-pj.pdf` conforme a vaga.

**Regra inegociável:** o motor **seleciona e reordena fatos reais**; nunca cria experiência,
tecnologia ou número que não esteja no `cv-base.json`.

---

## Fase 4 — Robustez e observabilidade

**Por que:** a Gupy muda o DOM sem aviso — já apareceram dois layouts diferentes num único dia. Hoje
eu só descubro que quebrou olhando log manualmente.

1. Alerta no Discord quando um tick terminar com taxa de falha acima de um limite.
2. Resumo diário no Discord: enviadas, avançadas, aguardando você, com links diretos.
3. Detecção de "layout desconhecido": se um formulário não render nenhuma pergunta, salvar HTML e
   avisar — em vez de reportar falha genérica.
4. Teste de fumaça semanal contra uma vaga conhecida, para detectar quebra antes que afete o lote.

---

## Fase 5 — Feedback loop (só depois de volume)

1. Registrar por candidatura: score de aderência, variante de CV, desfecho (avançou, eliminado, sem
   retorno).
2. Após ~30 dias, cruzar quais bullets e variantes aparecem mais nas que avançaram.
3. Ajustar seleção de CV e critérios de score com base em dado real.

---

## Ordem recomendada

```
Fase 0 (destravar)  →  Fase 1 (perfil Gupy)  →  Fase 2 (Greenhouse/Lever)
                                              ↘  Fase 3 (CV dinâmico)   →  Fase 4  →  Fase 5
```

Fases 2 e 3 podem correr em paralelo — fontes novas e qualidade de candidatura são independentes.

## Limites honestos

- Não existe garantia de "passar em X% dos ATS": cada empresa define seu corte e muita triagem é
  humana. O que dá para garantir é layout parseável e aderência textual verdadeira.
- CV dinâmico não compensa requisito ausente (a eliminação por graduação incompleta continuará
  acontecendo até 2027).
- Automação depende do DOM de terceiros; quebras vão acontecer e o plano assume manutenção contínua.
