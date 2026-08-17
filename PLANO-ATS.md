# Plano — Perfil Gupy + Currículos Dinâmicos otimizados para ATS

## Contexto

Hoje o apply-service candidata e avança etapas, mas envia **sempre o mesmo PDF** (`Icaro_Freitas_CV.pdf`,
maio/2026) e depende de um perfil Gupy que nunca foi revisado. Como a triagem da Gupy é feita pela GAIA
(IA que ranqueia candidato × descrição da vaga) e a maioria dos ATS pontua por aderência textual, esses
dois pontos são hoje o maior gargalo de conversão — mais do que volume de candidaturas.

---

## Fase 1 — Auditoria do perfil Gupy (fonte da verdade da triagem)

Na Gupy, a empresa vê o **perfil**, não o PDF. Um perfil incompleto derruba o match mesmo com CV bom.

**O que fazer**
1. Extrair o estado atual do perfil via sessão já autenticada (`portal.gupy.io/curriculum`): dados
   pessoais, resumo, experiências, formação, idiomas, competências, pretensão, disponibilidade.
2. Gerar um relatório de lacunas comparando com o `perfil.md` (que já tem o retrato real e completo):
   campos vazios, experiências sem descrição, competências não declaradas, senioridade divergente.
3. Preencher o que for objetivo e verificável (competências, descrições de experiência, resumo
   profissional) — sempre com fatos do perfil, nunca inventado.

**Critério de pronto:** perfil 100% completo, com as mesmas palavras-chave técnicas que aparecem nas
vagas-alvo (Node.js, NestJS, TypeScript, microsserviços, AWS, Kubernetes, observabilidade).

---

## Fase 2 — Motor de currículo dinâmico

**Arquitetura**
- `profile/cv-base.json` — fonte única estruturada: experiências, bullets, skills, formação. Derivado do
  `perfil.md` e dos scripts `gerar_cv_*.py` já existentes (reportlab).
- `src/cv/select.ts` — dado o texto da vaga, escolhe e reordena: quais experiências, quais bullets
  (prioriza os que casam com os requisitos), qual título profissional e quais skills destacar.
- `src/cv/render.ts` — gera o PDF (reportlab via script Python já pronto, ou PDFKit em Node) a partir da
  seleção. Layout ATS-safe (ver Fase 3).
- Integração: o applier chama o gerador antes de anexar; cada candidatura leva o PDF sob medida, salvo em
  `data/cvs/<jobId>.pdf` para auditoria.

**Regra inegociável:** o motor só **seleciona, reordena e reescreve ênfase** de fatos reais. Nunca cria
experiência, tecnologia ou número que não esteja no `cv-base.json`.

---

## Fase 3 — Otimização ATS (o que realmente pontua)

**Layout (o que quebra parser de ATS)**
- Uma coluna, sem tabelas, sem caixas de texto, sem cabeçalho/rodapé com informação essencial.
- Sem ícones, gráficos ou imagens; fontes padrão (Helvetica/Arial/Calibri).
- Datas no formato `MM/AAAA – MM/AAAA`; títulos de seção convencionais (Experiência Profissional,
  Formação, Competências).
- PDF com texto selecionável (nunca imagem); nome do arquivo `Icaro_Freitas_CV.pdf`.

**Conteúdo (o que pontua)**
- Espelhar a terminologia da vaga: se a vaga diz "microsserviços", não escrever só "microservices".
- Incluir a forma escrita e a sigla ("Integração Contínua (CI/CD)", "Amazon Web Services (AWS)").
- Bullets no formato ação + tecnologia + resultado mensurável (já existe material: 2-3min → 10-15s,
  9 microsserviços, 3 sistemas críticos, race condition eliminada).
- Densidade de palavras-chave natural — sem keyword stuffing (ATS moderno penaliza e o humano descarta).

**Medição**
- `src/cv/score.ts`: calcula cobertura de requisitos da vaga pelo CV gerado (% de termos-chave da
  descrição presentes no currículo) e registra junto da candidatura.
- Meta operacional: ≥ 75% de cobertura dos requisitos obrigatórios sem inventar nada. Abaixo disso, a
  vaga provavelmente não é aderente — sinal para **não** aplicar em vez de forçar.

---

## Fase 4 — Feedback loop

- Registrar por candidatura: score ATS calculado, variante de CV usada, e o desfecho (avançou de etapa,
  eliminado, sem retorno).
- Após ~30 dias, cruzar: quais bullets/variantes aparecem mais nas candidaturas que avançaram.
- Ajustar a seleção com base em dado real, não em achismo.

---

## Ordem de execução sugerida

1. Fase 1 (auditoria + preenchimento do perfil Gupy) — maior ganho imediato, afeta todas as candidaturas
   já enviadas.
2. Fase 3 (regras ATS) aplicada ao CV único atual — ganho rápido antes de qualquer automação.
3. Fase 2 (motor dinâmico) — precisa das duas anteriores para ter base e critério.
4. Fase 4 (feedback loop) — depois de volume suficiente para ter sinal.

## Riscos e limites

- **Não** dá para garantir "passar em X% dos ATS": cada empresa configura seu próprio corte e muitos
  usam triagem humana. O que dá para garantir é layout parseável e aderência textual honesta.
- CV dinâmico aumenta aderência, mas **não** compensa requisito ausente (ex.: vaga que exige graduação
  concluída ou 5 anos de Java).
- Todo texto gerado precisa sobreviver a uma entrevista — por isso a regra de nunca inventar.
