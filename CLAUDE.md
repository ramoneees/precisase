# Project: "Precisa-se" — Casa da Cidade Digital Platform

> Living context document. Update as the project evolves (new meetings, decisions, scope changes).

## Last updated
2026-07-12 — translated to English; added provisional project name.

## Provisional name

**Precisa-se** — working name for the app, chosen for covering both requests and offers (volunteering, donations, and future job matching) without sounding donation-only. Other names considered: Doarse, Elo, Ponte, Junta, Casa Conecta, Rede da Cidade. Not final — open to change as branding discussions continue.

## Overview

Casa da Cidade (a church) wants to build a digital platform to connect needs and offers within its community. The idea comes from experience with an earlier volunteering platform (`voluntariado.casadacidade.com`, a custom domain pointing to an external platform) that existed roughly 1–2 years ago and was used, for example, to turn the church building into a Sunday coworking space and allocate volunteers to partner companies (e.g., an insurance company).

## Core concept

This is not an isolated "job board" or "donation site." It's a matching mechanism between those who need something and those who offer it — whether paid work, volunteering, donation of goods, or services. The tone is communal and trust-based (built on referrals within the church), not purely transactional. The analogy used in the kickoff meeting: "I'm not selling a job, I'm connecting two parties."

Use cases mentioned:
- Employer looking for staff / person looking for a job.
- Someone offering a service (e.g., "I'm a painter, call me if you need one").
- Donation requests (e.g., mattresses, clothes for shelter homes).
- Volunteering for church activities (event setup, serving meals, etc.).
- Recruitment by community businesses that trust church referrals more than platforms like LinkedIn.

## MVP scope (decision from the meeting)

Prioritize **volunteering + donations** (requests and offers) in the first phase, since it's faster to deliver and test.

Jobs/recruitment is deferred to phase 2 or 3 — same matching logic, mainly changing the form/category.

### Key features discussed
- Post a need or an offer (what's needed, or what can be donated/done).
- Mark a request as "already resolved" to stop generating new contacts (identified problem: today, when someone asks for help on WhatsApp and gets multiple replies, there's no way to tell everyone it's already been handled).
- Volunteer reputation/history: someone who has already contributed a lot and is trusted can post directly, without needing prior approval (a "ranking" system for trusted volunteers, jokingly referred to as the "Golden Plus volunteer system" — there was symbolic recognition for volunteers at the church, like a barbecue voucher).
- Possible WhatsApp bot as an entry interface (people describe what they need via WhatsApp, the bot searches the database and/or redirects them to the platform) — but with caution: a prior experience from Rafaela showed that if WhatsApp becomes the main channel, the platform (the "shop window") stops being used and loses its purpose of centralizing/organizing opportunities. The bot should reinforce platform use, not replace it.
- Consider GDPR/LGPD in the collection and use of contact data.

## Format decisions

- **Responsive web app** (not a native app). Rationale: avoid app fragmentation (users already use a single church app for everything — registration, family, etc.) and reduce maintenance cost/complexity. A thin "wrapper" could be considered later if needed.
- Final contact between parties will likely happen via WhatsApp/phone (not necessarily inside the platform).
- Idea to eventually unify with the church's existing app (family registration, children, etc.) — but that's not MVP scope; this is being built from scratch.

## Available infrastructure

- The church has its own servers: hardware running multiple VMs (accounting, routing/networking via pfSense or similar, etc.), with daily backups replicated to a NAS at home (Tiago) and another one (Rafa/Rui). Security is mainly managed by Rafael Santos (church IT), supported by Tiago (former IT/networking professional, now a pastor).
- The church's current website is not hosted internally for security reasons.
- There's already precedent for testing internal apps (e.g., the church bookstore app, still in testing, running locally).
- Ramon has his own server (16GB RAM) temporarily available, with a tunnel/Cloudflare for secure access.
- Gabriel has no available infrastructure of his own right now (the server he had is allocated to another project — a technology class).

## People involved and roles

- **Ramon Rios** — leading the conceptualization and will formalize functional requirements; offers temporary server infrastructure.
- **Tiago Alves** — church pastor/leadership, former IT professional (networking/systems), will send a draft/flowchart of how a "need" would work (lifecycle: posting → response → resolution).
- **Rafaela Bento** — brought practical experience from a similar platform that "died" because it turned into pure WhatsApp exchange; suggests splitting into phases and making a diagram/flow before moving forward.
- **Rui Vieira** — more occasional participation; agrees a web app works well; warns that usage overhead might lead people to prefer sticking with plain WhatsApp.
- **Gabriel Cabral** — questions whether there's an existing base to reuse (conclusion: no, it will be built from scratch); raises the key web vs. mobile question; interested in growing this as the "digital arm of Casa da Cidade."
- **Rafael Santos** (mentioned, not present) — technically responsible for the church's IT infrastructure and network.

## Agreed next steps

1. Tiago sends a draft/flow of what each "need" could contain and what happens when someone picks it up or responds to it.
2. Ramon formalizes the functional requirements in technical language.
3. Rafaela suggests putting together a diagram (flowchart) of the process before the next meeting, to ensure everyone is aligned before starting to build.
4. Schedule a new alignment meeting with the diagram/requirements in hand.

## Risks and points of attention raised

- Risk of the platform becoming a "white elephant" (unused) if WhatsApp remains the de facto channel, as already happened in another of Rafaela's experiences.
- Need for a clear mechanism to close/end an already-resolved request, avoiding duplicate/wasted contacts.
- GDPR/LGPD to consider from the start.
- Scope tends to grow (idea of unifying with the church app, reputation system, etc.) — attention needed to not lose focus on the MVP.

## Related documents

- `docs/MVP.md` — machine-readable requirements brief (functional, non-functional, business rules, technical notes) for use by coding agents/LLMs.
- `docs/ARCHITECTURE.md` — DRAFT architecture (stack, data model, flows, infra, open questions). Living context for implementing sessions.
- `Requisitos_MVP_Casa_da_Cidade.docx` — formal requirements document (Portuguese), same content as `docs/MVP.md`, formatted for human stakeholders.
