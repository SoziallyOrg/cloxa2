# Cloxa business plan

Status: working commercial-validation plan, updated 27 August 2026.

Owner decisions already made:

- first market: Flanders, with Dutch manager and employee flows;
- first-customer size: 5–20 workers at one worksite;
- five business contacts are available for interviews, but none counts as interviewed, qualified, committed, or converted yet;
- Cloxa has no public deployment, real users, customer revenue, or approved compliance claim.

This document separates sourced facts from commercial hypotheses. It is not legal, employment, payroll, privacy, accounting, or tax advice. Sozially needs review from qualified Belgian professionals before it stores employee data or charges a customer.

## Decision in one page

Test one narrow offer:

> Cloxa helps a Dutch-speaking manager at one Flemish worksite collect factual work-time records, review corrections, and hand approved records to the person preparing payroll, with a visible history of changes.

Start with businesses that have 5–20 workers and still spend measurable time chasing, correcting, or retyping work-time records. Keep the customer’s existing process as the official payroll source during research pilots. Cloxa does not calculate wages, overtime, premiums, statutory rest, payroll declarations, or sector rules.

Run five manager interviews first. Select no more than two research pilots. Run each pilot beside the current system for two full payroll cycles. Ask for conversion to a €69 monthly paid beta, excluding VAT, only when the agreed operational and safety results pass. Waive onboarding for the first two research pilots; test a €199 onboarding fee for later customers.

Do not publish pricing, open self-service signup, import real employee data, or build requested extensions before the applicable gate in this plan passes.

## Next seven actions

Complete these in order. None authorises real employee data, customer outreach by Codex, spending, deployment, or a binding customer offer.

1. Fill the editable finance inputs: fixed monthly cost, owner-income target, one-time validation budget, available cash, and maximum monthly cash burn.
2. Put dates against the five ready contacts. Run a 10–15 minute qualifier first; invite only qualified businesses to a 45–60 minute evidence interview.
3. Complete five manager scorecards, at least three payroll-role reviews, and at least three employee usability interviews using invented data.
4. Obtain and archive dated quotes for exactly 5 and 20 workers from three to five alternatives. Record features, setup, term, cancellation, exports, support, and total price without guessing missing values.
5. Book the employment/social-secretariat, privacy, and accounting reviews in the reviewer matrix. Add the responsible owner, quote, budget, deliverable, and due date.
6. Finish the technical foundation and public synthetic staging. Keep hosted real data, live billing, and customer email disabled until their gates pass.
7. Select no more than two pilots only when every hard commercial gate, professional-review gate, and technical launch gate passes.

## Evidence ledger

### Owner facts

- Sozially chose Flanders/Dutch as first pilot market.
- First target has 5–20 workers at one worksite.
- Five business contacts are available for interviews. Interviews are not yet completed.
- No customer has used, bought, or renewed Cloxa.

### Product facts

- Phase 8 adds historical unpaid-break requests, manager review, append-only revisions
  and break-aware v2 factual snapshots in local source. Gate evidence and remaining
  limits are recorded in `PHASE_8_STATUS.md`; this does not authorize hosted use,
  real employee data, payroll acceptance or commercial claims.

- Local synthetic testing covers login, clock-in/out, manual records, correction requests, manager approval, CSV/JSON exports, tenant isolation, record-chain verification, employee blocking, and session revocation.
- Local database and browser gates pass, including 212 database assertions, five concurrency tests, a 50-writer load check, a 17-check synthetic restore drill, local password recovery, and the critical browser journey.
- Current manual records can contain breaks. The live clock-out journey does not yet capture break start and end events.
- Hosted database history differed from local source at the last read-only review, and current MCP permission must be restored before that evidence can be refreshed. Hosted Auth/Storage recovery, public staging, email delivery, payment, monitoring, and deletion are not production-proven.
- Bulk historical time import, workforce planning, analytics, team management, integrations, custom branding, public API keys, webhooks, and live billing are gated off for the pilot. They are not declared permanent exclusions; evidence must justify their priority and risk before they are enabled or built.

### Current public facts

- Statbel’s table *Aantal actieve btw-plichtige ondernemingen volgens werknemersklasse en plaats maatschappelijke zetel, meest recente jaar* reports 18,809 enterprises for `Jaar=2024`, `NIS werknemersklasse=5-9 werknemers`, `Gewest=Vlaams Gewest`, `Alle plaatsen`, and 11,185 under the same filters for `10-19 werknemers`: 29,994 combined. This is a registered-office size-band denominator, not a count of suitable worksites or buyers. It excludes businesses with exactly 20 workers and says nothing about hourly work, current tools, pain, or willingness to pay. [Statbel view metadata](https://bestat.statbel.fgov.be/bestat/api/views/9d19ebe2-f35a-4b51-ac1a-c153e6d77d67) and [Statbel result, JSON](https://bestat.statbel.fgov.be/bestat/api/views/9d19ebe2-f35a-4b51-ac1a-c153e6d77d67/result/JSON) (rechecked 26 August 2026).
- Since 1 January 2026, in-scope transactions between Belgian VAT-liable businesses require structured electronic invoices. The official page says an emailed PDF is insufficient and describes Peppol BIS as the normal route, subject to stated exceptions or an agreed EN 16931-compatible alternative. It also says the small-enterprise VAT exemption does not by itself remove this invoicing duty. [Belgian federal e-invoicing scope](https://efactuur.belgium.be/nl/article/voor-wie-wordt-e-facturatie-verplicht) (rechecked 26 August 2026).
- The federal software page says businesses need software connected to Peppol to send, receive, and process structured invoices. Its software list is an aid, not certification or a government recommendation. [Belgian federal e-invoicing software guidance](https://efactuur.belgium.be/nl/article/softwareoplossingen-voor-het-verzenden-ontvangen-en-verwerken-van-elektronische-facturen) (accessed 16 August 2026).
- Shyfter currently advertises a Belgian time-registration plan at €39 per month or €398 per year, including planning, QR clocking, geolocation, photo confirmation, automatic breaks, exports, and mobile/tablet apps. Cloxa’s €69 hypothesis therefore asks a premium for a narrower product and assisted workflow; interviews and signed orders must prove that premium. [Shyfter Belgian pricing](https://shyfter.com/nl-be/tarieven) (rechecked 26 August 2026).
- Stripe currently lists Billing pay-as-you-go at 0.7% of Billing volume, standard EEA cards at 1.5% + €0.25, and SEPA Direct Debit at €0.35 per successful payment. These are planning inputs, not a decision to use Stripe and not proof of compliant invoicing. [Stripe Billing pricing](https://stripe.com/nl-be/billing/pricing), [Stripe Belgian payments pricing](https://stripe.com/nl-be/pricing), and [Stripe local-payment pricing](https://stripe.com/nl-be/pricing/local-payment-methods) (rechecked 26 August 2026).

## Facts, hypotheses, and unknowns

| Type | Statement | Evidence needed next |
|---|---|---|
| Fact | Five interview contacts are available. | Scheduled dates and completed scorecards. |
| Fact | 29,994 is a Statbel count for Flemish VAT-registered enterprises in the 5–19 worker bands. | No further proof needed; do not call it market demand. |
| Fact | Belgian structured B2B invoicing rules have applied since 1 January 2026 to in-scope transactions. | Accountant confirms Sozially’s exact VAT and invoicing treatment. |
| Hypothesis | Managers lose enough normalised monthly time or money on work-time corrections and payroll handoff to buy a separate tool. | Last-payroll examples, payroll periods/year, minutes, other costs, recoverable value, and conditional orders. |
| Hypothesis | One worksite with 5–20 workers is the best first segment. | Five interviews, then another batch if evidence varies by sector or size. |
| Hypothesis | Assisted setup and reviewable corrections justify €69 per month despite lower-priced, broader competitors. | Two signed conditional orders at €69 and one full-price conversion. |
| Hypothesis | Referrals and founder-led sales can acquire customers with payback inside six months. | Recorded founder hours, cash spend, conversion rate, and contribution. |
| Unknown | Which worker types, schedules, joint committees, and work-regulation steps fit a real-data pilot. | Written Belgian employment review for each pilot candidate. |
| Unknown | Which export fields each payroll operator will accept. | Review of synthetic exports and blank format documentation. |
| Unknown | Actual monthly support, infrastructure, Peppol, payment, and accounting cost per customer. | Provider quotes, invoices, and time logs. |

## Ideal first customer hypothesis

Qualify for all of these characteristics:

- 5–20 workers at one Flemish worksite;
- a Dutch-speaking manager owns record approval, and one named role prepares or sends payroll inputs;
- hourly or work-time-dependent activity creates recurring record collection and correction work;
- current process uses paper, spreadsheets, chat messages, a basic clock, or software that still requires retyping or repeated follow-up;
- after normalising for payroll frequency, at least two manager hours or €100 per month is tied to collection, correction, approval, or handoff;
- stable internet, an agreed outage fallback, browser access, and private employee email access are available;
- payroll operator will review a synthetic Cloxa export;
- buyer can approve €69 per month and a later €199 onboarding fee;
- first pilot does not require offline mode, payroll calculations, declarations, custom integrations, multiple sites, or native mobile apps.

Normalise pain before comparing businesses:

```text
manager labour per payroll period = manager minutes / 60 × customer-provided loaded hourly cost
monthly process cost = (manager labour per period + other cost per period)
                       × payroll periods per year / 12
monthly recoverable value = monthly process cost × customer-estimated avoidable share
value-to-price ratio = monthly recoverable value / €69
```

Use the customer’s own loaded hourly cost or leave it blank; do not invent one. Monthly payroll uses 12 periods/year, four-weekly uses 13, and weekly uses 52. The two-hour/€100 monthly pain floor, avoidable share, and €69 price remain hypotheses. A value-to-price ratio of 2 or more is a stronger signal, not a fact or automatic qualification. Record prospects below the floor instead of changing their answers to force fit.

Do not choose a sector because it is familiar. Hospitality, construction, transport, security, agriculture, and other sectors can have specific schedules, registrations, or joint-committee rules. A qualified Belgian adviser must decide whether a candidate fits the pilot boundary.

## Problem and positioning hypothesis

Cloxa’s first workflow is:

1. Employee records start, end, and any supported manual break.
2. Employee requests a correction without silently replacing approved history.
3. Manager compares the current record with the proposed change.
4. Manager exports approved factual records for payroll handoff.
5. Employer can review who changed or approved a record.

Positioning to test:

> Spend less time chasing payroll-period records, with a review trail for corrections processed through Cloxa, for one small Flemish team.

Do not market Cloxa as “compliant,” “complete under Belgian law,” “payroll-ready,” “immutable,” or “error-free.” Do not claim generic time tracking is a market advantage. Interviews must explain why the buyer would choose Cloxa over its current spreadsheet, payroll portal, clocking tool, Shyfter, Strobbo, TimeMoto, or another established product.

## Pilot product boundary

Pilot includes:

- employer setup and employee invitations;
- browser clock-in/out and manual time entry;
- manual break entry where the current flow supports it;
- correction request and manager decision;
- factual worked-time totals;
- CSV/JSON export and review history;
- one assisted setup session and Dutch email support during stated hours.

Pilot gates off:

- bulk historical time import;
- workforce planning and schedule comparison;
- dashboards beyond the operational records needed for the pilot, broader analytics, and team-management features;
- absence management;
- overtime, premium, wage, rest, or payroll calculations;
- DmfA, DIMONA, CheckInAtWork, and sector declarations;
- native mobile apps, SSO, custom branding, public API keys, webhooks, and custom integrations;
- automatic subscription billing and public signup.

These gates protect the narrow pilot. Later evidence can promote a gated capability into a reviewed roadmap; an interview request alone does not.

## Employment, privacy, payroll, VAT, and Peppol boundaries

Official Belgian material describes different record and consultation duties for different work arrangements. It does not prove that every employer needs Cloxa or that Cloxa satisfies a particular duty.

- FPS Employment describes specific time-follow-up data, access, and retention requirements for deviations by some part-time workers. [Part-time performance monitoring](https://employment.belgium.be/en/node/9745) (accessed 16 August 2026).
- FPS Employment describes a time-follow-up system for flexible schedules, including identity, daily duration, and additional start/end/break information for fixed-schedule part-time workers, plus access and five-year retention rules in that context. [Working time and flexible schedules](https://employment.belgium.be/en/node/3860) (rechecked 26 August 2026).
- Work regulations contain mandatory information, including applicable schedules, and amendment procedures vary with the workplace. [FPS Employment: work regulations](https://employment.belgium.be/en/node/3218) (accessed 16 August 2026).
- An individual account includes workdays and hours by pay period along with wage information. Cloxa is not positioned as that account or as payroll software. [FPS Employment: individual account](https://employment.belgium.be/en/node/3228) (accessed 16 August 2026).
- The Belgian Data Protection Authority states that employer authority does not remove employee privacy rights. European Commission guidance says controller–processor duties must be defined in a binding contract and that processors need appropriate guarantees and controls over subprocessors. [Belgian DPA workplace privacy](https://dataprotectionauthority.be/burger/thema-s/privacy-op-de-werkplek) and [European Commission processor guidance](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/obligations/controllerprocessor/can-someone-else-process-data-my-organisations-behalf_en) (accessed 16 August 2026).

Before a real-data pilot, relevant professionals must answer in writing:

- whether Cloxa may operate only as a parallel convenience tool or as any part of the customer’s official process;
- which start, end, break, schedule, access, consultation, correction, and retention rules apply;
- which work-regulation or worker-representative steps the employer must complete;
- which party is controller or processor, which subprocessors apply, and which notices, agreements, and rights procedures are required;
- which fields and controls the payroll operator accepts;
- Sozially’s VAT treatment, invoice wording, cancellation, credit-note, and revenue-recognition process.

Commercial boundary:

- use an external accountant-approved, Peppol-connected invoicing product for paid beta rather than building Peppol into Cloxa;
- generate and transmit the required structured invoice before or alongside collection; an emailed PDF alone is not the process;
- treat payment collection as separate from invoicing;
- prefer SEPA Direct Debit or bank transfer if customers, accountant, and provider process support it; keep cards as a measured fallback;
- keep Stripe and live billing disabled until invoicing, collection, cancellation, failed-payment, refund, and credit-note flows pass together.

## Required reviewer matrix

Professional review is a launch input, not a compliance badge. Fill every blank before a real-data pilot.

| Reviewer | Required deliverable | Pass evidence | Sozially owner | Quote/budget | Due date |
|---|---|---|---|---:|---|
| Belgian employment adviser | Candidate-specific note covering applicable work arrangement, work-regulation or consultation steps, record fields, access, correction, and retention questions | Written answer identifies no unresolved blocker to the proposed parallel-pilot scope and lists every customer action required before start | ______ | €______ | ______ |
| Customer’s social secretariat or payroll reviewer | Synthetic export map and customer-run reconciliation procedure, including identifiers, cut-off, corrections, rejected rows, totals, and escalation | Reviewer accepts a synthetic file and signs the record-level comparison method; only aggregate mismatch results go to Sozially unless a separate signed scope permits more | ______ | €______ | ______ |
| Belgian privacy adviser or DPO | Review of roles, DPA, notices, subprocessors, access, retention/deletion, rights requests, incident handling, and pilot data flow | Approved document set and written list of residual actions with no unresolved high-risk blocker | ______ | €______ | ______ |
| Accountant | VAT position, Peppol workflow, invoice content, payment matching, cancellations, refunds, credit notes, and revenue treatment | Written checklist plus successful synthetic invoice/credit-note/payment-reconciliation test in the chosen tools | ______ | €______ | ______ |

“Meeting held” is not pass evidence. Save the dated deliverable, scope, reviewer identity, decision, open actions, and approval expiry or review date.

## Pricing hypothesis

Next interview offer:

- €69 per month, excluding VAT;
- one worksite and up to 20 active workers;
- monthly cancellation during paid beta;
- Dutch email support during stated hours;
- €199 one-time onboarding for customers after the first two research pilots;
- no permanent free plan and no annual commitment during validation.

The earlier €49 hypothesis was never published or sold. Retire it as the primary test: using the cost assumptions below, it produces about 63% monthly contribution, below the 70% target. The €69 anchor produces enough room to test a supported product without hiding unpaid founder labour.

This is still a difficult price test because Shyfter advertises a broader €39 plan. Do not justify €69 with a feature checklist. Require a measurable problem, assisted setup value, trusted correction workflow, and a signed conditional order. “Sounds reasonable” does not count.

If fewer than two of five eligible decision makers accept the conditional €69 order, record whether the cause was weak pain, price, trust, timing, missing core function, or an existing alternative. Run another five-business interview batch before discounting or expanding scope.

## Competitor comparison worksheet

Collect three to five dated alternatives before final pricing. Request or configure the exact same scenario twice: one Flemish worksite with 5 workers and with 20 workers. Do not infer per-user totals from marketing copy when minimums, modules, hardware, setup, support, or annual terms are unclear.

| Alternative | Exact 5-worker monthly total excl. VAT | Exact 20-worker monthly total excl. VAT | One-time cost | Minimum term/cancellation | Quote/page date | Source URL or private quote reference | Archived evidence |
|---|---:|---:|---:|---|---|---|---|
| Shyfter | ______ | ______ | ______ | ______ | ______ | ______ | ______ |
| Strobbo | ______ | ______ | ______ | ______ | ______ | ______ | ______ |
| TimeMoto | ______ | ______ | ______ | ______ | ______ | ______ | ______ |
| Current payroll portal/process | ______ | ______ | ______ | ______ | ______ | ______ | ______ |
| Other named alternative | ______ | ______ | ______ | ______ | ______ | ______ | ______ |

For each row, also record:

- clock-in/out methods and hardware requirement;
- manual break and correction workflow;
- change/audit history visible to manager and employee;
- exports and named payroll connections;
- planning, import, analytics, and team-management scope;
- employee app/browser requirements;
- setup, training, support channel, and response terms;
- price indexation, worker-count rule, annual discount, trial, and refund terms;
- which claims come from a live demo, contract/quote, or public marketing page.

Use `not stated` when evidence is missing. Archive a dated PDF or screenshot of each public price page and retain private quotes in Sozially’s access-controlled business records, not in this repository. Record access date, locale, worker count, selected modules, and VAT treatment. Vendor pages can change; the source register proves only what was visible on its access date.

## Unit economics, P&L, and cash model

Use revenue excluding VAT. Count founder time as an economic cost even when it is not a cash payment. Keep one-time validation/R&D, repeatable acquisition, onboarding, recurring service, and company fixed costs separate.

### Editable inputs

Only `P`, published processor rates, and the stated scenario arithmetic are populated. Owner must replace every blank and every unverified allowance before a paid beta.

| Symbol | Input | Starting value | Evidence/status |
|---|---|---:|---|
| `P` | Monthly subscription excl. VAT | €69.00 | Price hypothesis |
| `H` | Founder loaded hourly cost | €40.00 | Unverified planning assumption; replace |
| `V` | Customer-variable hosting, database, email, backup, monitoring, Peppol allocation | €7.00/customer/month | Unverified allowance; replace with invoices |
| `R` | Failed-payment, refund, credit-note, dispute, and bad-debt allowance | €______ /customer/month | Blank until observed |
| `F` | Company fixed monthly cash costs excluding owner target | €______ /month | Owner input |
| `O` | Owner monthly cash-income target before personal tax | €______ /month | Owner input |
| `C` | Cash available to Sozially for Cloxa | €______ | Owner/accountant input |
| `D` | One-time validation and R&D budget | €______ | Professional review, security/stabilisation, synthetic staging, research pilots |
| `B` | Cash reserved for pilot/setup work | €______ | Includes waived setup for first two pilots |
| `K` | Cash setup cost for one later customer | €______ | Provider, training, import/export preparation; no founder time |
| `T` | Founder setup time for one later customer | ______ hours | Target at most 3 hours |

Core formulas:

```text
monthly contribution/customer = P - payment/billing fee - V - support labour - R
contribution margin            = monthly contribution/customer / P
repeatable CAC payback months  = repeatable CAC / monthly contribution/customer
break-even paying customers    = ceil((F + O) / monthly contribution/customer)
onboarding contribution        = €199 - K - (T × H)
```

### Payment and support sensitivity

At €69, Stripe’s listed Billing fee is `€69 × 0.7% = €0.483`. Listed successful-payment cost is €0.35 for SEPA Direct Debit or `€69 × 1.5% + €0.25 = €1.285` for a standard EEA card. Combined planning fees are therefore €0.833 for SEPA and €1.768 for card collection. This excludes failed payments, refunds, disputes, bad debt, currency conversion, tax, and later price changes.

The 70% contribution gate permits total customer-variable cost of only `€69 × 30% = €20.70`. With `V=€7` and `H=€40`, sensitivity before `R` is:

| Support/customer/month | Support labour | SEPA contribution | SEPA margin | SEPA headroom to 70% | Card contribution | Card margin | Card headroom to 70% |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 15 min | €10.00 | €51.17 | 74.2% | €2.87 | €50.23 | 72.8% | €1.93 |
| 30 min | €20.00 | €41.17 | 59.7% | -€7.13 | €40.23 | 58.3% | -€8.07 |
| 60 min | €40.00 | €21.17 | 30.7% | -€27.13 | €20.23 | 29.3% | -€28.07 |

Any `R` allowance reduces contribution and headroom euro for euro. The headline €69/card/15-minute case has only €1.93 monthly headroom before failed payments, refunds, credit notes, disputes, bad debt, or an increase in the €7 service allowance. It is not a comfortable margin. If observed `R` exceeds €1.93, or service cost is higher, that case fails the 70% gate.

### Low/base/high founder worksheet

These scenarios test arithmetic; they are not forecasts. They exclude `R`, `F`, `O`, onboarding, tax, and one-time validation spend until owner fills those inputs.

| Scenario | Paying customers `N` | Collection/support assumption | MRR | Contribution/customer before `R` | Customer contribution before `R`, `F`, `O` |
|---|---:|---|---:|---:|---:|
| Low/stress | 25 | Card, 60 support min | €1,725 | €20.23 | €505.80 |
| Base test | 50 | 50% card/50% SEPA, 30 support min | €3,450 | €40.70 | €2,034.98 |
| High/target-operation | 100 | SEPA, 15 support min | €6,900 | €51.17 | €5,116.70 |

Complete each row:

```text
monthly operating result before owner target = N × (contribution/customer - R) - F
monthly cash gap after owner target           = N × (contribution/customer - R) - F - O
break-even customers                          = ceil((F + O) / (contribution/customer - R))
```

| Scenario | `R` | `F` | `O` | Result before owner | Result after owner | Break-even customers |
|---|---:|---:|---:|---:|---:|---:|
| Low/stress | €______ | €______ | €______ | €______ | €______ | ______ |
| Base test | €______ | €______ | €______ | €______ | €______ | ______ |
| High/target-operation | €______ | €______ | €______ | €______ | €______ | ______ |

### Setup budget and runway

The first two research pilots pay no onboarding fee, so `B` must cover their cash setup cost and owner must record the hours as validation/R&D. Later onboarding is economically viable only when `€199 - K - (T × H)` is positive. Quote bulk import, data cleanup, or custom export work separately if those capabilities later pass roadmap gates.

```text
cash after validation/setup reserve = C - D - B
monthly recurring cash burn         = max(0, F + O - N × (contribution/customer - R))
runway months                        = cash after validation/setup reserve / monthly recurring cash burn
```

If monthly burn is zero or negative, report “cash-generating at these assumptions,” not infinite runway. Ask the accountant whether owner withdrawals, VAT timing, corporation tax, annual software, insurance, and professional fees belong in `F`, `O`, or a separate cash-timing schedule.

Viability gates:

- at least 70% recurring contribution after normal support and observed `R`;
- no more than 15 support minutes per customer per month after onboarding, unless price or service model changes;
- positive onboarding contribution with no more than three founder hours;
- repeatable post-validation CAC payback no longer than six months;
- at least four of the first five paying customers renew after month three;
- no unpriced custom work inside the subscription;
- owner-entered cash runway remains above the minimum approved with the accountant.

If €69 cannot meet these gates, raise price, narrow included support, automate repeated work, change segment, or stop. Do not compensate with unpaid founder time. Do not estimate lifetime value from a handful of customers; measure renewal at months 1, 3, 6, and 12 first.

## Low-budget acquisition plan

Do not call the first five interviews, professional reviews, pilot support, security work, or product changes “CAC.” They are one-time validation/R&D because the process is still being discovered. Record them against `D`, report them honestly, and do not use them to claim a repeatable six-month payback.

### Validation funnel

Purpose: decide whether to continue, not optimise acquisition.

```text
5 ready contacts
5 short qualifiers attempted
up to 5 evidence interviews when qualified
3+ payroll-role reviews
3+ employee usability interviews
no more than 2 signed research pilots
target: 1 full-price paid conversion and month-3 renewal
```

Ask each suitable manager for one introduction outside Sozially’s website-client network to reduce warm-contact bias. Ask payroll operators or social secretariats for process feedback and later introductions only after a synthetic export proves useful. Do not promise an integration or referral fee.

### Repeatable post-validation funnel hypothesis

Start measuring repeatable CAC only after the segment, offer, qualification questions, demo, price, proposal, and onboarding steps are stable enough to repeat without product R&D. Initial time budget per acquired customer:

| Repeatable stage | Volume | Founder time each | Total time |
|---|---:|---:|---:|
| Review target against written ICP | 10 | 4 min | 40 min |
| Personal outreach/follow-up | 6 | 8 min | 48 min |
| 10–15 minute qualifier | 4 | 15 min | 60 min |
| 45–60 minute evidence interview/demo | 2 | 60 min | 120 min |
| Proposal, decision follow-up, close/admin | 1 | 45 min | 45 min |
| **Total for one acquired customer** | | | **313 min / 5.22 hours** |

At the placeholder `H=€40`, this is €208.67 founder labour before cash acquisition spend. Using the unrounded €50.232 card-case contribution, the six-month CAC ceiling is €301.39, leaving €92.73 for repeatable cash acquisition cost. Onboarding is excluded from CAC because it has its own €199 price and contribution test; recurring support is already in monthly contribution. If either is free, include its full cost in the relevant calculation.

This funnel is a hypothesis, not an achievement. Replace volumes, conversion rates, minutes, and cash cost after every cohort. A prospect requiring product design, professional analysis, custom integration, or new compliance work returns to validation/R&D; do not hide that work inside repeatable CAC.

Channel order:

1. referrals outside the warm contact network;
2. payroll-role or adviser introductions after useful synthetic evidence;
3. Dutch problem-focused landing page and direct inbound;
4. paid acquisition only after five customers renew for three months and observed contribution supports the CAC ceiling.

After one paying customer completes a clean payroll cycle, request referral and testimonial permission separately. Do not tie a discount to a positive testimonial. Record source, founder time, cash spend, stage, reason lost, and signed revenue for every lead.

## Pilot design and paid conversion

Run no more than two no-fee research pilots, each for two full payroll cycles. Free access buys research, not a testimonial or an automatic discount.

Before setup:

- complete manager, payroll-operator, and employee interviews;
- record baseline minutes, corrections, missing records, current spend, and current alternative;
- receive professional confirmation that the parallel pilot fits the business;
- agree one approver, one payroll reviewer, weekly 20-minute meeting, support hours, and outage fallback;
- sign pilot terms and required data-processing documents;
- keep the customer’s current system as the official payroll source.

Shared pass gates:

- lost or duplicate time records: 0;
- unauthorised record access in agreed tests: 0;
- export differences from the approved source: 0;
- manual database repairs: 0;
- no open critical or high security defect;
- shift completion and manager-time targets meet numbers agreed before the pilot;
- founder support remains within the agreed allowance.

The customer or its authorised payroll reviewer performs the record-level comparison inside its approved environment after each payroll cycle. It sends Sozially aggregate results only: records compared, matches, mismatch count by agreed category, and whether the acceptance threshold passed. Do not send worker identifiers, dates, times, or row-level exports. Sozially may inspect record-level data only when a separate signed scope defines purpose, lawful basis, minimum fields, secure channel, access, retention/deletion, and responsible people.

Within five business days after the second customer-run reconciliation, ask the decision maker to accept or reject the €69 paid beta. Conversion requires an explicit written order and an accountant-approved structured-invoice process.

After the first two research pilots, stop offering two-cycle free pilots unless a new, written research question requires one. Use a synthetic demo, paid onboarding, and time-limited paid beta instead.

## Validation scorecard

### Problem gate

- At least three of five managers independently describe the same recurring collection, correction, or payroll-handoff problem.
- At least two show two manager hours or €100 of normalised cost per month after applying payroll periods/year.
- Answers include a recent example, current alternative, and switching constraint.

### Product gate

- At least two businesses pass every pilot eligibility check.
- Payroll reviewers accept the fields and workflow in a synthetic export.
- At least three workers complete the Dutch browser demo without founder coaching.
- Professional reviewers identify no unresolved blocker to the parallel pilot.

### Price gate

- Two eligible purchase decision makers sign pilot terms naming €69 monthly conversion price and a decision date.
- One pilot converts at the full recurring price.
- That customer renews for three paid months.

### Per-business hard gates

A score of 12/14 is not enough by itself. Before selecting a business for a pilot, its discovery scorecard must have all four hard-gate rows at `2/2`:

- Pilot fit: `2/2`;
- Payroll handoff: `2/2`;
- Decision process: `2/2`;
- Price evidence: `2/2`.

Any disqualification or any hard-gate score below `2/2` defers the business, regardless of total score. Professional, privacy, accounting, security, and launch gates remain separate and can also stop the pilot.

### Economics gate

- Normal support reaches 15 minutes or less per customer per month after onboarding.
- Contribution margin reaches at least 70% using actual costs.
- Founder-led acquisition payback reaches six months or less.

A failed gate triggers another interview or pilot batch. Feature requests do not override weak problem, price, safety, or economics evidence.

## Release stages

### Foundation

Finish reviewed source control, hosted database reconciliation, public synthetic staging, hosted invitation and password-reset tests, monitoring, deletion procedures, incident ownership, and Belgian professional review. Local password recovery and synthetic restore drills already pass.

### Private research pilot

Train with synthetic data first. Add employee data only after launch gates and owner approval. Run two businesses beside current systems for two payroll cycles.

### Paid beta

Convert one pilot through the approved Peppol invoicing and collection workflow. Keep public signup and automatic billing disabled. Use monthly terms and founder-led onboarding.

### Controlled commercial launch

Require two full-price conversions, at least one three-month renewal, passed recovery tests, no open critical/high defect, approved customer documents, and positive measured contribution. Keep invite-only onboarding until support and acquisition rates hold across at least five paying customers.

## Main risks

- Interviews may show weak pain or preference for an existing payroll portal.
- €69 may not be credible against a broader €39 competitor.
- Warm contacts may answer more positively than the wider market.
- Sector and joint-committee requirements may disqualify available contacts.
- Employee email/device access may exclude useful hourly-work segments.
- Live clocking does not yet prove every break-recording requirement for every work arrangement.
- Hosted recovery, email, monitoring, deletion, invoicing, and collection still need production proof.
- Founder support may exceed the margin model.
- Gated import, planning, analytics, team management, or integration requests may expose a different target market; building them too early would hide whether the core problem is valuable.

## Glossary

| Term | Meaning in this plan |
|---|---|
| `MRR` | Monthly recurring subscription revenue excluding VAT; excludes onboarding and one-time work. |
| Contribution | Subscription revenue minus customer-variable payment, service, support, and failure/refund costs. |
| Contribution margin | Contribution divided by subscription revenue. Not company profit. |
| Validation/R&D spend | Non-repeatable cost of discovering the segment/offer and making product, legal, privacy, accounting, or technical work ready. Not CAC. |
| Repeatable CAC | Post-validation founder labour and cash used by a stable process to acquire one paying customer. Excludes separately priced onboarding and recurring support. |
| CAC payback | Repeatable CAC divided by monthly contribution. |
| Fixed costs `F` | Company costs that do not vary directly with one additional customer. |
| Owner target `O` | Owner-entered monthly cash-income target used for break-even planning; not guaranteed salary or profit. |
| Break-even customers | Paying customers required for recurring contribution to cover `F + O` under stated assumptions. |
| Runway | Months available cash can fund a positive monthly cash burn after one-time reserves. |
| Payroll period | Customer’s pay-processing interval. Use periods/year to normalise cost to a month. |
| Conditional order | Written intent to buy at a stated price if named pilot results pass; it is not payment or an automatic contract. |
| Peppol | Network used for structured electronic invoices; it does not collect payment or prove Cloxa’s employment-law compliance. |
| Hard gate | Required evidence that cannot be offset by points elsewhere in a scorecard. |

## Source register

External sources received an initial review on 16 August 2026; sources marked above were rechecked on 26 August 2026. Recheck laws, official guidance, and prices again before pilot terms or customer offers.

| Source | Used for | Authority |
|---|---|---|
| [Statbel view metadata](https://bestat.statbel.fgov.be/bestat/api/views/9d19ebe2-f35a-4b51-ac1a-c153e6d77d67) and [2024 result](https://bestat.statbel.fgov.be/bestat/api/views/9d19ebe2-f35a-4b51-ac1a-c153e6d77d67/result/JSON) | Exact table title and Flemish 5–9/10–19 worker-band filters | Belgian official statistics |
| [Federal e-invoicing scope](https://efactuur.belgium.be/nl/article/voor-wie-wordt-e-facturatie-verplicht) | 2026 structured B2B invoicing scope and formats | Belgian federal information portal |
| [Federal e-invoicing software guidance](https://efactuur.belgium.be/nl/article/softwareoplossingen-voor-het-verzenden-ontvangen-en-verwerken-van-elektronische-facturen) | Peppol-connected software and list limitations | Belgian federal information portal |
| [FPS Employment: part-time monitoring](https://employment.belgium.be/en/node/9745) | Situation-specific time-follow-up questions | Belgian labour authority |
| [FPS Employment: working time](https://employment.belgium.be/en/node/3860) | Flexible-schedule time-follow-up questions | Belgian labour authority |
| [FPS Employment: work regulations](https://employment.belgium.be/en/node/3218) | Schedule and work-regulation questions | Belgian labour authority |
| [FPS Employment: individual account](https://employment.belgium.be/en/node/3228) | Boundary between factual records and payroll account | Belgian labour authority |
| [Belgian DPA: workplace privacy](https://dataprotectionauthority.be/burger/thema-s/privacy-op-de-werkplek) | Employee privacy boundary | Belgian data-protection authority |
| [European Commission: processors](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/obligations/controllerprocessor/can-someone-else-process-data-my-organisations-behalf_en) | Controller–processor contract questions | EU official guidance |
| [Shyfter Belgian pricing](https://shyfter.com/nl-be/tarieven) | Current competitor price reference | Vendor primary source |
| [Stripe Billing pricing](https://stripe.com/nl-be/billing/pricing) | Billing fee assumption | Vendor primary source |
| [Stripe local payment pricing](https://stripe.com/nl-be/pricing/local-payment-methods) | SEPA/card collection assumption | Vendor primary source |

Archive dated vendor-price evidence before relying on it in a proposal. A current URL is not a historical price record.
