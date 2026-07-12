# Precisa-se

Plataforma digital da **Casa da Cidade** para conectar necessidades e ofertas dentro da comunidade — voluntariado, doações de bens/serviços e, numa fase futura, oportunidades de trabalho.

> **Nome provisório.** "Precisa-se" cobre pedidos e ofertas (voluntariado, doações e, no futuro, emprego) sem soar como um site apenas de doações. Outros nomes considerados: Doarse, Elo, Ponte, Junta, Casa Conecta, Rede da Cidade. Não é definitivo.

---

## O que é

Não é uma "banca de empregos" nem um "site de doações" isolado. É um **mecanismo de correspondência** entre quem precisa de algo e quem o oferece — trabalho pago, voluntariado, doação de bens ou serviços. O tom é comunitário e baseado em confiança (referências dentro da comunidade), não transacional.

A plataforma nasce de uma experiência anterior (`voluntariado.casadacidade.com`, que existiu há ~1–2 anos e foi usada, por exemplo, para transformar o edifício da igreja num espaço de coworking ao domingo e alocar voluntários a empresas parceiras). Está a ser reconstruída do zero — não há código-base reutilizável.

### Âmbito do MVP

**Incluído:**
- Voluntariado (pedidos + ofertas)
- Doações de bens/serviços (pedidos + ofertas)

**Excluído (fases futuras):**
- Correspondência de empregos/recrutamento
- Bot de WhatsApp como interface de entrada
- Sistema de reputação/"Golden Plus" com publicação automática
- Unificação com a app existente da igreja

---

## Documentação

| Documento | Descrição |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | Contexto do projeto, pessoas envolvidas, papéis, riscos |
| [`docs/MVP.md`](./docs/MVP.md) | Requisitos legíveis por máquina (FR, BR, NFR) para agentes/LLMs |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | **Rascunho (DRAFT)** de arquitetura — stack, modelo de dados, fluxos, infraestrutura, perguntas em aberto |
| `Requisitos_MVP_Casa_da_Cidade.docx` | Documento formal de requisitos (Português) para stakeholders humanos |

### Stack recomendada (resumo)

- **Frontend + API:** Next.js (App Router) + TypeScript + Tailwind CSS
- **Base de dados:** PostgreSQL 16 via Prisma
- **Autenticação:** Auth.js (NextAuth v5), hashing argon2id, RBAC
- **i18n:** next-intl, com `pt-PT` como locale padrão
- **Notificações:** Resend (email transacional); WhatsApp apenas como link `wa.me`
- **Infraestrutura:** Docker Compose + Caddy + Cloudflare Tunnel
- **Observabilidade:** Sentry + logs estruturados + `/health`

> Consulte [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) para o detalhe completo, alternativas consideradas e as 17 perguntas em aberto (Q1–Q17).

---

## Equipa e papéis

- **Ramon Rios** — lidera a conceção; formaliza requisitos funcionais; oferece infraestrutura temporária.
- **Tiago Alves** — pastor/liderança, ex-profissional de TI (redes/sistemas); responsável pelo fluxo/lifecycle de uma "necessidade".
- **Rafaela Bento** — experiência prática com plataforma similar anterior; sugere fases e diagrama antes de avançar.
- **Rui Vieira** — participação ocasional; alerta para o risco de sobrecarga de utilização.
- **Gabriel Cabral** — questiona a base existente (conclusão: construir do zero); levanta a questão web vs. mobile.
- **Rafael Santos** — responsável técnico pela infraestrutura e rede da igreja (mencionado, não presente).

---

## Estado atual

- [x] Reunião de arranque (kickoff) realizada
- [x] Requisitos consolidados em `docs/MVP.md`
- [x] Rascunho de arquitetura em `docs/ARCHITECTURE.md`
- [ ] Diagrama/fluxo do lifecycle de uma "necessidade" (Tiago)
- [ ] Validação dos requisitos pela equipa (Ramon)
- [ ] Resposta às perguntas em aberto Q1–Q17
- [ ] Reunião de alinhamento com diagrama + requisitos consolidados
- [ ] Início da implementação

---

## Próximos passos

1. **Tiago** envia o rascunho/fluxo do que cada "necessidade" contém e o que acontece quando alguém a assume ou responde.
2. **Ramon** valida os requisitos consolidados em linguagem técnica.
3. **Rafaela** ajuda a construir o diagrama (fluxograma) antes da próxima reunião.
4. **Equipa** marca uma reunião de alinhamento com diagrama + requisitos em mãos.

---

## Como contribuir

Este projeto está numa fase inicial de conceção. As alterações aos documentos de requisitos/arquitetura devem ser discutidas nas reuniões de alinhamento antes de serem consolidadas. Marcar itens não resolvidos com `Open question:` para que fiquem visíveis.

## Privacidade e dados

A plataforma lida com dados de contacto de membros da comunidade. A conformidade com **RGPD/LGPD** é um requisito desde o início (consentimento explícito, política de privacidade, exclusão de dados a pedido do utilizador). Consulte `docs/ARCHITECTURE.md` §7 (Segurança e privacidade) para o detalhe do design.
