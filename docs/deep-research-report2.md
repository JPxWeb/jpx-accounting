# Building an internal Swedish bookkeeping system for an AB with AI-assisted receipts on Azure

## Executive summary and recommendations

Building an internal bookkeeping system for a Swedish private limited company (AB) that uses the cash method (kontantmetoden/bokslutsmetoden in practice) is technically feasible at your stated volume (5–10 receipts/month) and can be run on a very low Azure spend if you lean on serverless components and avoid always-on databases. The core feasibility constraint is not OCR or LLM cost; it is implementing an audit-grade ledger and archival model that meets **Bokföringslagen** requirements for (a) verifications/vouchers and their required fields, (b) correction traceability (who/when), (c) system documentation + processing history, and (d) archival form, retention period, and storage location. citeturn8view0turn7view1turn9view0

For an AB using the cash method, your system must also handle the statutory “cash posting” allowances and limits: **cash in-/out-payments must be recorded no later than the next working day**, other transactions “as soon as possible”, and—crucially—if annual net turnover is normally ≤ SEK 3 million you may book transactions when payment occurs, but **at year-end all unpaid receivables and payables must still be booked**. citeturn8view0

A minimal compliant architecture on Azure (cheap-first) can be implemented as:

- **Evidence store**: Azure Blob Storage in Swedish regions + immutable storage options, with vouchers linked via IDs and metadata.
- **Append-only ledger + audit trail**: an event-sourced “journal” (append-only postings) with explicit correction postings capturing *who/when*, and period locks.
- **OCR/extraction**: Azure Document Intelligence (prebuilt receipt/invoice or read) on upload.
- **AI suggestions with guardrails**: deterministic rule engine for “hard law” checks (invoice requirements, VAT SEK conversion, retention/traceability) + a constrained LLM layer that only proposes (never posts), always outputs structured suggestions with citations back to a curated legal corpus.
- **Continuous analysis**: scheduled batch jobs that look for anomalies/subscription gaps/VAT inconsistencies and create review tasks, not automatic actions.

The cheapest-first recommendation for an internal tool at your scale is to **ship an MVP that focuses on compliance and traceability**, and intentionally keep automation narrow:

- **Must-have**: vouchers/verifications, append-only postings + corrections, system documentation & processing history, archival in Sweden for seven years, multi-currency capture with SEK posting, VAT invoice validation, SIE export, and a human-in-loop “approve suggestion” workflow.
- **Nice-to-have later**: bank feeds (PSD2/aggregator), Peppol/e-invoicing, richer analytics, and broader automation.

Given the market pricing for Swedish bookkeeping SaaS (often low hundreds SEK/month), the build-vs-buy decision hinges on whether you need (1) unusually strong internal controls/auditability, (2) bespoke workflows, or (3) product ambitions after internal validation. citeturn27search0turn28search4turn27search2

## Legal and regulatory requirements that drive the system design

This section lists the binding obligations most directly shaping architecture and guardrails. Citations include the exact statutory provisions where possible.

### Bookkeeping Act core duties that your software must enable

Your company (AB) must fulfil bookkeeping in accordance with good accounting practice, keep verifications for all bookkeeping entries, and maintain system documentation and processing history describing the bookkeeping system and the processing of each entry. citeturn8view0turn7view1

Key design-driving provisions (with exact citations):

| Obligation (what the law requires) | Statutory citation | Practical system implication |
|---|---|---|
| Books must be presentable in registration order (journal) and systematic order (general ledger) with controls for completeness and overview | Bokföringslagen 5 kap. 1 § citeturn8view0 | Store postings as immutable events (journal order) plus derived ledgers/views; maintain reconciliation checks and sequence integrity. |
| Timing: cash in/out by next working day; other transactions as soon as possible; small businesses may book on payment; year-end unpaid receivables/payables must be booked | Bokföringslagen 5 kap. 2 § (incl. third paragraph) citeturn8view0 | Workflow must support cash method and enforce year-end accrual tasks; reminders for unpaid items at year-end. |
| Corrections must record **when** and **who**; if corrected via separate entry, must be easily discoverable when reviewing original | Bokföringslagen 5 kap. 5 § and 9 § citeturn8view0 | Strong audit trail: corrections as new postings referencing original; require authenticated user identity on every change. |
| Every business event must have a voucher (verifikation); if received electronically, that info should be used as voucher (with supplements as needed) | Bokföringslagen 5 kap. 6 § citeturn8view0 | Receipt/invoice is preserved as the evidence object; postings reference voucher ID; support “supplement” metadata for missing fields. |
| Voucher must include compiled date, transaction date, what it concerns, amount, counterparty, plus voucher ID and info linking voucher ↔ event without difficulty | Bokföringslagen 5 kap. 7 § citeturn8view0 | Data model must store these fields; AI ingestion must not “guess” missing mandatory voucher fields—must prompt user. |
| System documentation + processing history must be created so that the system and processing of entries can be followed and understood without difficulty | Bokföringslagen 5 kap. 11 § citeturn7view1 | Maintain versioned system documentation and per-posting processing logs (including AI outputs and rule hits). |
| Archival forms: paper or electronic; electronic must be printable immediately | Bokföringslagen 7 kap. 1 § citeturn9view0 | Store all accounting information in a form that can be exported/printed on demand; test “printability” as a compliance check. |
| Preserve in original condition/format/content (paper “skick”; electronic “format och innehåll”) | Bokföringslagen 7 kap. 1 § citeturn9view0 | Store original files as immutable evidence; keep derived OCR text separately; ensure originals remain unchanged. |
| Retention and location: durable, easily accessible, retained through the 7th year after year-end; stored in Sweden; systems to print must be available in Sweden | Bokföringslagen 7 kap. 2 § citeturn9view0 | Azure region choice becomes a compliance feature (Sweden region preferred); define retention policies and access controls. |
| Allowed to store electronic accounting info in another EU country only if you notify Skatteverket (or FI), grant immediate electronic access for control, and can print immediately in Sweden | Bokföringslagen 7 kap. 3 a § citeturn9view0 | If you ever deploy outside Sweden, incorporate a “Skatteverket notification + control access” procedure, and document it. |
| Transfer/destroy originals is permitted if transfer does not risk alteration or loss | Bokföringslagen 7 kap. 6 § citeturn9view0 | Supports digitisation workflows, but requires technical/organisational controls; keep evidence integrity proofs and logs. |
| AB must close books with annual report and publish it | Bokföringslagen 6 kap. 1 § citeturn8view0 | Even if you don’t generate the annual report inside the tool, the system must export complete data for annual reporting. |

### BFN guidance for limited companies

entity["organization","Bokforingsnamnden","swedish accounting board"] explains that limited companies’ annual reports must follow BFN’s “K regulations” (e.g., K2 for smaller companies within ÅRL thresholds), tying your system’s outputs to the reporting frameworks your accountant/auditor expects. citeturn1search0

### Skatteverket VAT requirements that constrain “auto-suggested postings”

entity["organization","Skatteverket","swedish tax agency"] provides the most operationally useful primary guidance for receipt/invoice automation:

- VAT rates: standard 25%, reduced 12% and 6%, plus VAT-exempt supplies. citeturn10search1  
- Input VAT deduction *must* be verifiable by an invoice; if you have not received an invoice, or if it lacks necessary information, you may not deduct input VAT. citeturn16view0  
- A purchaser’s invoice must include specific fields (date, unique serial number, vendor VAT number; purchaser VAT number in cases like reverse charge; names/addresses; goods/services description; supply date; taxable base; VAT rate; VAT payable, etc.). citeturn16view0  
- Multi-currency constraint: regardless of invoice currency, VAT must be shown in SEK; if EUR is the accounting currency, VAT may be shown in EUR; conversion should use specified exchange rate sources such as the Nasdaq OMX Stockholm joint mid-price (as published e.g. via the Riksbank site) or the ECB rate. citeturn15view1  
- For business entertainment representation meals, Skatteverket guidance caps the VAT deduction base (notably the SEK 300 rule with split across VAT rates such as 12% food vs 25% alcohol). citeturn10search9  

Implication: your AI must treat VAT as a **rule-driven area**. If invoice fields are missing or ambiguous, the system should mark the voucher “VAT deduction blocked pending review” rather than guess. citeturn16view0

### GDPR: retention vs erasure in an accounting context

Your receipt store will almost certainly contain personal data (names, addresses, sometimes employee data). entity["organization","Integritetsskyddsmyndigheten","swedish data protection authority"] emphasises storage limitation: personal data must not be kept longer than necessary for the purposes, and when purposes are fulfilled the main rule is anonymisation or deletion. citeturn17search0  
However, IMY also notes that deletion requests can be denied where the processing is necessary to comply with a legal obligation (or to defend legal claims). citeturn17search7  
For your bookkeeping system, the legal obligation is the statutory retention requirement in Bokföringslagen (7 kap. 2 §). citeturn9view0turn17search7

Practical design consequence: implement **archival segregation**: restrict access to older receipts (retained for legal reasons) while keeping them durable and retrievable; maintain a retention schedule aligned to the seven-year rule, and document the legal basis for retention. citeturn9view0turn17search4

### EU AI Act: transparency obligations for your internal assistant

entity["organization","European Union","supranational union"] Regulation (EU) 2024/1689 (AI Act) imposes transparency duties that are directly relevant even for internal systems:

- Providers must ensure that AI systems intended to interact directly with natural persons inform them they are interacting with AI, unless obvious; with limited exceptions. citeturn22view2  
- Providers of AI systems generating synthetic audio/image/video/text must ensure outputs are marked in a machine-readable format and detectable as AI-generated or manipulated. citeturn22view3  
- The regulation’s official gateway is on Eur-Lex (note: Eur-Lex page access may be JS-gated in some environments). citeturn18search0turn18search16  

Practical consequence: label your assistant clearly (“AI suggestion”), keep it in suggestion mode, and store logs of outputs and user actions for traceability and accountability. citeturn22view2turn7view1

### PSD2 and bank feeds: avoiding regulatory scope creep

If you later add direct bank connectivity (account information services / payment initiation) rather than manual file import, you can cross into regulated “payment services”.

entity["organization","Finansinspektionen","swedish financial supervisory authority"] states that providing payment services requires authorisation from FI; smaller providers can apply to be exempt from the authorisation obligation and register as a “registered payment service provider” depending on turnover thresholds. citeturn23search0  
FI has also clarified that third-party providers must use designated interfaces and must identify themselves; they may not access payment account information via a bank’s customer interface without identifying themselves. citeturn23search1  

For an internal-only bookkeeping tool, the cheapest and least risky path is: start with **manual bank statement import** (or no bank integration) and revisit open banking later via licensed aggregators if needed. citeturn23search1turn23search0

## Required system features for a compliant, audit-ready internal AB ledger

A minimal-but-compliant internal system is mostly a **ledger + evidence archive + audit trail** with well-defined exports. The features below are those you should treat as “compliance-critical”.

### Voucher chain, immutable originals, and audit trail

The system must ensure that **every booked business event has a voucher** and that the voucher includes required information (dates, what/amount/counterparty, voucher ID) so the relationship voucher ↔ posting can be established “without difficulty”. citeturn8view0  
Store the uploaded receipt/invoice as the “original evidence object” and never mutate it; store OCR text and extracted fields as derived artefacts. This supports the requirement to preserve material in its original condition/format/content. citeturn9view0

Corrections must never overwrite history. If a booking is corrected, you must record who corrected it and when; and ensure the correction is discoverable when reviewing the original entry. citeturn8view0  
This is the legal backbone for an **append-only ledger** and explicit correction postings (an “event sourcing” pattern). citeturn8view0

### Period locking and year-end cash-method handling

Under cash-method allowances, you can book at payment (if you qualify by turnover), but must still book unpaid receivables and payables at year-end. citeturn8view0  
Implement:

- period close (“lock”) mechanics for completed VAT periods and fiscal year close,
- a year-end checklist: unpaid supplier invoices and customer invoices must be accrued (booked) on balance date even if not paid.

### System documentation and processing history

Bokföringslagen requires system documentation (overview of system organisation/structure) and processing history that allows following and understanding processing of each posting “without difficulty.” citeturn7view1  
Treat this as a product feature, not paperwork:

- versioned “system doc” stored in the archive,
- event logs per voucher/posting with timestamps, user identity, and processing steps (OCR → extraction → rule checks → AI suggestion → user approval). citeturn7view1turn8view0

### Multi-currency handling with SEK as accounting currency and VAT SEK conversion

For the bookkeeping ledger itself, the accounting currency for an AB is SEK by default (euro is permitted only if you choose euro as accounting currency). citeturn8view0  
Therefore, for NOK/EUR receipts you should store at least:

- transaction currency, totals, VAT by rate **in transaction currency** (as captured),
- exchange rate used (source + timestamp),
- SEK converted amounts for posting.

For VAT/invoices, Skatteverket’s brochure is explicit: regardless of invoice currency, VAT must be shown in SEK (unless EUR is your accounting currency), and conversion must use specified exchange rate sources. citeturn15view1  
This drives an explicit “VAT conversion” step in your ingestion pipeline and a permanent record of the rate used.

### BAS mapping and SIE export

The Swedish chart-of-accounts landscape is dominated by BAS. You can start by supporting a subset of BAS accounts you actually use, then expand. BAS publishes chart-of-accounts documents (PDF) that are used widely in practice. citeturn24search4  

You should implement SIE export early. entity["organization","SIE-Gruppen","swedish SIE association"] describes SIE as an open standard for transferring accounting data between systems; it is widely adopted and a de facto standard, and while the format is open to everyone only members can get their software approved. citeturn24search2turn24search5  
For internal use, “approval” is not essential, but **SIE export is your escape hatch** (auditor/accountant collaboration, migrations, external offering readiness). citeturn24search2

### E-invoicing readiness and Peppol (future-proofing)

If your AB supplies the public sector, Sweden’s e-invoicing act requires contracting authorities to accept EU-standard e-invoices. citeturn26search2  
entity["organization","Digg","agency for digital government sweden"] also provides practical guidance: suppliers to the public sector must provide e-invoices, and Digg/SFTI recommend Peppol BIS Billing 3. citeturn26search0turn26search12

For internal-only MVP, you can postpone Peppol—but design your data model so that invoices/receipts have a place for structured fields and identifiers that map cleanly to EN 16931 / Peppol BIS later. citeturn26search2turn26search0

## AI design and safety for grounded suggestions and continuous analysis

Your stated requirement—AI that proposes postings, continuously analyses for missed items, and is grounded in law with guardrails—maps best to a “rules-first, AI-second” architecture.

### Deterministic rule engine as the compliance backbone

Implement the following as **non-LLM code** (deterministic checks), because they are directly grounded in statute/official guidance and must not be subject to hallucination:

- Voucher minimum fields and voucher ↔ posting traceability. citeturn8view0  
- Correction rules (“who/when”, linkability). citeturn8view0  
- Retention and storage rules (7 years; stored in Sweden unless procedures for EU storage). citeturn9view0  
- VAT deduction gating: no deduction if invoice missing or missing necessary information. citeturn16view0  
- Invoice field completeness for VAT deduction (the required invoice fields list). citeturn16view0  
- VAT must be shown in SEK and conversion rate requirements if invoice currency differs. citeturn15view1  
- VAT rate sanity checks (25/12/6/exempt) where inferable, but with human review on ambiguity. citeturn10search1turn16view0

Output of this layer should be **machine-readable rule hits** (e.g., `VAT_INVOICE_MISSING_SERIAL_NUMBER`, `VAT_SEK_MISSING`, `VOUCHER_COUNTERPARTY_MISSING`) and each rule hit should store the legal source reference (e.g., “SKV 552B invoice fields”, “BFL 5:7”). citeturn16view0turn8view0

### LLM suggestion layer: constrained, structured, and never authoritative

The LLM should:

- propose account mapping (BAS account + VAT code + posting pattern),
- propose vendor normalisation (merchant identity and reuse previous patterns),
- generate a short explanation **but only using retrieved sources**,
- emit outputs in a strict schema (JSON-like) to prevent “creative accounting narratives”.

At approval time, user actions should be explicit: “accept”, “edit”, “reject”, with reason codes stored for later evaluation and model improvement.

Because EU AI Act transparency duties require users be informed they interact with AI, label the assistant clearly and always keep “human oversight” in the workflow. citeturn22view2

### Retrieval-augmented grounding with a curated legal corpus

For “grounded in Swedish law”, treat your sources as a curated, versioned corpus:

- Bokföringslagen extracts: 4 kap., 5 kap., 7 kap. (as these drive system requirements). citeturn8view0turn9view0  
- Skatteverket VAT brochure (SKV 552B) sections for invoice requirements and currency conversion. citeturn16view0turn15view1  
- Specific Skatteverket guidance pages you rely on (VAT rates, business entertainment caps). citeturn10search1turn10search9  
- Your internal accounting policy (what accounts you use, approval thresholds, allowed expense categories).

Then implement RAG with explicit constraints:

- retrieval must return the exact excerpts used in the answer,
- the model must cite those excerpts in output metadata,
- if retrieval returns nothing relevant, model must respond “insufficient basis” and ask a targeted question.

This approach aligns with the AI Act’s emphasis on transparency and traceability principles (and reduces the risk of the assistant inventing legal rules). citeturn22view1turn22view2

### Continuous analysis for missed items (subscriptions, VAT issues)

At your scale, “continuous analysis” should be implemented as **scheduled review generation**, not automated postings:

Subscription gap detection:
- build a simple “recurring merchant” model (merchant + typical cadence + amount distribution),
- flag missing expected transactions (e.g., no charge in a month where past 6 months had charges).

VAT issue detection:
- flag invoices where required fields are missing,
- flag foreign currency invoices where VAT isn’t clearly in SEK and conversion basis not captured,
- flag mixed-rate expenses (e.g., restaurant with alcohol) for representation rules. citeturn16view0turn15view1turn10search9  

For each alert, generate:
- the evidence (why flagged),
- the rule hits,
- safe next questions (“Is this business entertainment? Was alcohol included? Who attended?”),
- and a proposed correction pattern (not posted automatically).

### Logging, evaluation, and hallucination guardrails as “audit trail”

Because Bokföringslagen requires processing history that makes treatment of each posting followable without difficulty, store AI-specific logs as part of that processing history:

- model name/version and prompt template version,
- retrieved sources IDs and text snippets,
- confidence score and why (features / similarity),
- user action outcome (accepted/edited/rejected). citeturn7view1turn8view0

Also align with AI Act output transparency and marking where relevant (e.g., if you generate narrative text for audit notes, mark as AI-generated in metadata). citeturn22view3turn22view2

## Azure cheap-first architecture and cost scenarios

### Minimal compliant Azure architecture

The architecture below is designed to (a) keep accounting data “in Sweden” and (b) minimise always-on costs by favouring consumption plans. Bokföringslagen’s storage-in-Sweden rule makes region selection a compliance control; Azure’s region listing helps you select Swedish regions. citeturn9view0turn0search14turn0search2

```mermaid
flowchart TB
  U[User: drag/drop/paste receipt] --> W[Web UI]
  W --> API[Upload API (Azure Functions)]
  API --> B[(Blob Storage: Evidence Archive)]
  API --> Q[Queue / Event trigger]
  Q --> OCR[Document Intelligence: OCR + extraction]
  OCR --> X[Extraction JSON + OCR text (Blob)]
  X --> RULES[Deterministic rule engine]
  RULES -->|rule hits| L[(Append-only Ledger Store)]
  RULES -->|needs clarification| TASKS[Review tasks]
  RULES --> LLM[LLM suggestion layer (Azure OpenAI)]
  LLM --> RAG[Retriever (AI Search or DB vector)]
  RAG --> KB[(Curated Legal Corpus + Company Policy)]
  LLM --> SUG[Suggested postings + explanation + citations]
  SUG --> APPROVE[Human approval UI]
  APPROVE --> L
  L --> EXP[SIE export generator]
  EXP --> OUT[SIE file for accountant/auditor]
  API --> KV[Key Vault (secrets/keys)]
  L --> LOGS[AI + audit logs]
```

### Service choices and architectural options

The cheapest-first challenge is the **database**: managed relational services can dominate your bill if sized for “enterprise” rather than your tiny workload. The comparison below gives three pragmatic options, all capable of meeting compliance requirements if implemented correctly.

| Option | Intended use | Core Azure components | Pros | Cons | Monthly runtime cost at your scale (5–10 receipts/month)\* | Monthly runtime cost at 5k receipts/month\* |
|---|---|---|---|---|---|---|
| Minimal cheap | Internal AB, low volume, compliance-first | Blob Storage + Functions consumption + Document Intelligence + small vector store (in DB or file) + Key Vault | Very low baseline; most services have meaningful free grants | More engineering effort (data modelling, querying); avoid “DIY database pitfalls” | Often near-zero Azure infra cost; OCR likely free (<500 pages) citeturn3view3turn2search1turn2search4turn29search0 | OCR + LLM dominate; still modest unless you add always-on DB/search citeturn2search1turn23search0 |
| Balanced | Internal now, external later possible | Blob + Container Apps or Functions + Document Intelligence + Azure SQL/PG + optional AI Search | Easier queries/reporting; smoother path to external product | Baseline DB cost can be non-trivial; more ops | If you use always-on Postgres flexible server, expect ≥ low hundreds USD/month citeturn29search2 | Scales operationally; but DB/search costs become meaningful relative to OCR/LLM citeturn29search2turn29search1 |
| Enterprise-ready | External SaaS ambition, higher assurance | Everything in Balanced + AI Search + private endpoints + redundancy + more monitoring | Stronger security posture, multi-tenant readiness, higher availability | Expensive baseline; overkill for your current volume | Likely not justified for 5–10 receipts/month | Suitable if you truly scale and sell externally |

\*Costs depend heavily on region, pricing model, and whether you choose always-on DB/search. The table emphasises which components typically dominate.

### Cost estimates with explicit assumptions

Below are ballpark monthly costs split into (A) your current scale and (B) a scaled scenario. Where exact prices are official and stable, they are cited; where pricing is model/region-dependent, formulas are provided and you should plug in current list prices from your Azure tenant.

#### OCR (Azure Document Intelligence)

Azure Document Intelligence pricing indicates a free tier of 0–500 pages/month, and then page-based charges; for example, “Batch read” is listed at $1.50 per 1,000 pages and “Batch prebuilt models” at $10 per 1,000 pages. citeturn2search1

Assumptions:
- 1 receipt ≈ 1 page (typical for receipts; invoices may be multi-page).
- Use **Read** when you can, and **Prebuilt** receipt/invoice when you need structured fields.

| Scenario | Pages/month | Read OCR cost | Prebuilt receipt/invoice cost |
|---|---:|---:|---:|
| Your scale | 5–10 | $0 (within 500 free pages) citeturn2search1 | $0 (within 500 free pages) citeturn2search1 |
| Scaled | 5,000 | ~ $7.50/month (5,000 × $1.50/1,000) citeturn2search1 | ~ $50/month (5,000 × $10/1,000) citeturn2search1 |

#### Compute (Functions vs Container Apps)

Azure Functions consumption includes a monthly free grant of 1 million requests and 400,000 GB-seconds. citeturn2search3  
Azure Container Apps consumption includes free monthly allocations: 180,000 vCPU-seconds, 360,000 GiB-seconds, and 2 million requests. citeturn5search2

At your scale, compute is usually “free-tier negligible” unless your pipeline is inefficient or you run heavy batch workloads.

#### Storage (Blob evidence archive)

Blob storage list pricing examples show hot-tier storage around ~$0.018/GB-month in some published tables (plus transaction costs). citeturn2search4  
At both your scale and 5k receipts/month, storage is rarely a primary cost driver: even 5k receipts/month at 1 MB each is ~5 GB/month, typically tens of cents/month in hot tier (before any redundancy choices). citeturn2search4

#### Secrets (Key Vault)

Key Vault pricing includes a flat per-operation rate; one published figure is $0.03 per 10,000 operations for keys/secrets/certificates operations. citeturn29search0  
At your scale, this is effectively negligible.

#### Retrieval / RAG indexing (Azure AI Search vs alternatives)

Azure AI Search pricing includes an “agentic retrieval” component where the first 50M tokens per month are free, then $0.022 per 1M additional tokens. citeturn29search1  
This means that for an internal, small knowledge base (a few dozen law/guidance snippets), you can often keep retrieval cost at $0 and focus on correctness.

For smaller deployments, a common “cheap-first” alternative is to store embeddings in your own DB (if you already pay for it) or to use a minimal index (even file-based) given your tiny corpus; the main trade-off is engineering complexity and query performance.

#### LLM token costs

Azure OpenAI is priced per token (input/output), but published token tables on the Azure pricing page can be difficult to extract programmatically in some environments; treat token pricing as a **variable you plug into the formulas**. citeturn2search2  
For a defensible ballpark, OpenAI’s own API pricing (not Azure-specific) provides clear reference values for current model families—for example, gpt-5-mini and gpt-5-nano tiers show very low per-1M-token prices relative to flagship models. citeturn2search10

A practical way to budget is to own your token envelope:

- **Per receipt suggestion** (structured output): assume 1,500–3,000 input tokens and 200–600 output tokens if you keep prompts compact and avoid long narrative output.
- **Per “continuous analysis” run**: batch across all data; use small models; avoid re-sending full corpora by using retrieval.

Example formula (replace with your model’s prices):
- Monthly LLM cost = (input_tokens/1,000,000 × input_price) + (output_tokens/1,000,000 × output_price). citeturn2search10

### Illustrative cost breakdown chart (5k receipts/month)

The chart below compares a few realistic mixes (not commitments), using official OCR page pricing and treating LLM cost as “typically smaller than OCR at modest token budgets”.

```
Monthly cost (5k receipts ≈ 5k pages)
Prebuilt OCR ($10/1k pages):  ██████████████████████████  ~$50
Read OCR ($1.5/1k pages):     ███                         ~$7.5
LLM suggestions (compact):    █                           ~$few-$tens (model-dependent)
Storage (5–10 GB):            ▏                           ~$<1
Compute (serverless):         ▏                           ~$0–few
```

OCR numbers are directly from Azure pricing. citeturn2search1  
Compute free grants are from Azure Functions and Container Apps pricing pages. citeturn2search3turn5search2

## Licensing, integrations, and regulatory triggers

### BAS licensing

entity["company","BAS-kontogruppen i Stockholm AB","BAS chart owner"] publishes terms for machine-readable BAS via API, stating it may be used for internal operations and can be sublicensed to third parties through integration into business systems (subject to conditions). citeturn25view0  
However, BAS’s page for machine-readable format indicates the previous product is being replaced and pricing may not currently be listed transparently; they request contact via email. citeturn24search0

Practical recommendation:
- For MVP, use downloadable BAS (PDF/Excel) and implement a limited internal mapping.
- If you move toward external SaaS, treat BAS licensing as an early workstream, because embedding BAS into a product is a licensing issue. citeturn25view0turn24search0

### SIE implications

SIE is open to implement, but “approved software” status is limited to SIE members. citeturn24search2turn24search5  
For internal-only use, export correctness matters more than “approval”.

### E-invoicing legal obligations and Peppol

Swedish law (2018:1277) requires contracting authorities to accept e-invoices compliant with the European standard; Digg provides guidance that suppliers must provide e-invoices in public procurement contexts and recommends Peppol BIS Billing 3. citeturn26search2turn26search0turn26search12  
If you do B2G business, “Peppol readiness” can become an operational necessity.

### PSD2 triggers for bank feeds

If you later provide account information services (AIS) or payment initiation services (PIS) as a third-party provider, FI authorisation/registration rules can apply. citeturn23search0turn23search1  
To keep your internal MVP cheap and low-regulatory-friction, prefer manual bank statement imports until you have a clear need and a strategy (licensed aggregator vs becoming a regulated actor). citeturn23search1turn23search0

### “Tax suggestion” liability when offering externally

Internal-only use keeps liability largely inside your company governance. If you later offer externally, any “tax optimisation suggestions” become a product risk area: you may need contractual disclaimers, carefully bounded scope (“decision support, not advice”), quality assurance processes, and evidence trails demonstrating that you do not encourage unlawful deductions—especially because Skatteverket guidance makes VAT deduction conditional on invoice validity. citeturn16view0turn10search1  
Your strongest mitigation is the “rules-first + cite sources + human approval” architecture.

## Risks, build-vs-buy comparison, and recommended MVP roadmap

### Key risks and concrete mitigations

| Risk | Why it matters | Mitigation controls (practical) | Primary sources |
|---|---|---|---|
| Compliance drift (law/tax rules change) | Rules and guidance evolve; wrong automation can create systematic errors | Version your legal corpus and rules; add regression tests keyed to statutory requirements; log rule versions per posting | Bokföringslagen system documentation requirement supports traceability citeturn7view1turn8view0 |
| Audit-trail failure (retroactive edits) | Corrections must record who/when; postings must be traceable | Append-only journal; corrections as new entries referencing originals; mandatory user identity | Bokföringslagen 5 kap. 5 §, 7 § citeturn8view0 |
| VAT deduction errors | Deduction requires valid invoice; missing fields can invalidate deductions | Hard-rule gating: if required fields missing → block VAT deduction posting; ask targeted questions | SKV 552B invoice requirements + deduction verification citeturn16view0 |
| Multi-currency conversion mistakes | VAT and accounting currency constraints can be violated | Store conversion basis + exchange rate source; ensure VAT shown in SEK and conversion follows allowed sources | SKV 552B currency in invoices citeturn15view1; Bokföringslagen accounting currency citeturn8view0 |
| AI hallucinations | Could “invent” legal rules or misclassify VAT | Deterministic rule engine; RAG-only explanations; “insufficient basis” mode; structured outputs; human approval always | AI Act transparency principle reinforces disclosures and governance citeturn22view2turn22view1 |
| GDPR retention vs deletion requests | Accounting retention can conflict with “delete my data” expectations | Retention schedule explicitly tied to legal obligation; deny deletion where lawful; minimise access, segregate archive | IMY on storage limitation and erasure exceptions citeturn17search0turn17search7; Bokföringslagen retention citeturn9view0 |
| PSD2 scope creep via bank feeds | Direct bank integrations may trigger FI regulation | Start with manual imports; later use licensed aggregator or pursue authorisation with full compliance | FI on authorisation and TPP obligations citeturn23search0turn23search1 |

### Build-vs-buy comparison at your scale

At 5–10 receipts/month, the largest “cost” of building is engineering time and compliance ownership. Swedish SaaS offerings are often inexpensive and already handle receipt OCR and suggestions.

| Dimension | Build internal | Buy off-the-shelf (examples) |
|---|---|---|
| Monthly cash spend (software fees) | Potentially low Azure bill if serverless; but unknown engineering cost | entity["company","Fortnox","swedish accounting software"] lists Bokföring at 189 SEK/month and invoice interpretation services priced per item (e.g., 4.90 SEK/item for “Fakturatolkning”). citeturn27search0 entity["company","Visma Spcs","swedish accounting software vendor"] lists Bokföring at 199 SEK/month. citeturn28search4turn28search0 entity["company","Bokio","swedish bookkeeping software"] lists plans from 49 SEK/month (with additional usage-based fees depending on services). citeturn27search2turn27search10 |
| Control and auditability | Maximum (you decide logs, guardrails, evidence model) | Good but vendor-defined; you rely on vendor’s compliance posture |
| Compliance burden | You own interpretation, updates, tests, documentation | Vendor carries most implementation burden; you still must operate correctly |
| Time-to-value | Slow (weeks–months) | Fast (hours–days) |
| Differentiation | High (custom workflows, internal policy integration, “explainable AI with citations”) | Low unless you layer processes/integrations |

Given the low transaction volume, “buy” is often rational unless you clearly need custom controls or you are intentionally investing toward a future external product.

### Recommended MVP scope and roadmap

**MVP (internal AB, cash method, 5–10 receipts/month)**

Must-have:
- Voucher ingestion (drag/drop/paste), store immutable original evidence; capture voucher core fields and link to postings. citeturn8view0turn9view0  
- Append-only journal with correction postings recording who/when; period locking, and year-end accrual checklist for unpaid items. citeturn8view0  
- VAT invoice validation + block VAT deduction if invoice incomplete; VAT shown in SEK with recorded exchange rate source for NOK/EUR. citeturn16view0turn15view1  
- SIE export to enable accountant/auditor workflows. citeturn24search2turn24search5  
- System documentation + processing history, including AI logs. citeturn7view1turn8view0  

Nice-to-have:
- Subscription gap detection and anomaly alerts as review tasks.
- Lightweight RAG citations and “why” explanations that reference your curated corpus.
- Peppol readiness (data model), though full Peppol integration can wait unless you do public sector work. citeturn26search2turn26search0  

**Roadmap toward external offering**
- Formalise BAS licensing strategy (if embedding machine-readable BAS). citeturn25view0turn24search0  
- Add tenant isolation, stronger security controls, and potentially AI Search for scalable RAG. citeturn29search1  
- Decide bank integration path (aggregator vs FI-regulated TPP). citeturn23search0turn23search1  
- Expand compliance coverage (reverse charge, imports, representation, mixed VAT, etc.), backed by test suites and versioned legal corpora. citeturn10search9turn16view0  

### Follow-up questions that will materially refine the design

Do you currently use any existing bookkeeping software for the AB (even if minimal), and would you need SIE import as well as export to migrate history? citeturn24search2

Is your AB’s annual net turnover clearly below SEK 3 million (to rely on the cash posting allowance in Bokföringslagen 5 kap. 2 § third paragraph), and do you want the system to enforce that threshold as a guardrail? citeturn8view0

Do you have recurring supplier invoices (subscriptions) that arrive as PDFs by email, or mainly photo receipts? This affects “inbox” design (email forwarding vs only upload) and OCR needs. citeturn16view0

What is your intended approval workflow (single approver vs two-person approval for high amounts), and do you need an audit trail that separates “preparer” and “approver” roles (stronger internal control)? citeturn8view0turn7view1

What is your tolerance for “manual classification” when VAT-critical fields are missing—should the system block posting, allow posting but block VAT deduction, or allow both but flag it? citeturn16view0

Do you expect to supply Swedish public sector entities within the next 12–24 months (which would make Peppol/e-invoicing a priority)? citeturn26search2turn26search0