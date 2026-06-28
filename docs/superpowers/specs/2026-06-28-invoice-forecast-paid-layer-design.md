# Invoice Forecast — Paid Invoices Layer (design)

**Date:** 2026-06-28
**Feature:** Invoice Forecast (Power User) — enhancement
**Problem:** Paid invoices that aren't linked to a selected invoice task type are
dropped from the forecast entirely. The initial/deposit invoice is often triggered
on document approval and is **not linked to a task** (or is linked to a non-Invoice
task such as a Milestone). Today's query filters `task.taskType.id in [types]`, so
that collected cash is invisible in both the chart and the totals.

Confirmed against Titus PROD 2026-06-28 (`amountPaid > 0`): Draper #17 ($75,955,
`task: null`), Larson #9 ($29,936, `task: null`), Power #10 ($32,591, `task: null`),
Baron #9 ($1,800, task type "Milestone"). All currently missing.

## Decisions (locked with user)
1. **3-way display:** Paid / Committed / Projected (new Paid layer).
2. **Paid dated by `issueDate`** (populated on every paid invoice, including
   task-less ones).
3. **Paid respects the `[From, To]` window** on `issueDate`, same as scheduled.
   Default `From = current month` is unchanged — past deposits appear when the user
   clears `From`; a deposit issued this month shows by default.

## Conceptual model — collected + scheduled
- **Paid** — any `customerInvoice` with `amountPaid > 0`, **regardless of task type
  or whether a task exists**. Dated by `issueDate`. Not split by sold.
- **Committed** — *unpaid* invoices on **sold** jobs, linked to a selected task
  type. Dated by `task.startDate`. (current behavior, minus paid ones)
- **Projected** — *unpaid* invoices on **not-yet-sold** jobs. Dated by
  `task.startDate`. (unchanged)

The Paid set and the Scheduled set are **disjoint by construction**: the scheduled
path skips any invoice with `amountPaid > 0`; those land in Paid instead. No id
dedup needed.

## Queries (mirrored in worker + client direct path)
1. **Scheduled** (`fetchForecastInvoices` / `fetchInvoicesDirect`): unchanged
   filter (`task.taskType.id in [types]`, `task.startDate` within `[From,To]`, open
   jobs). **Add `amountPaid` to selected fields.** Records with `amountPaid > 0` are
   skipped during normalize.
2. **Paid** (new `fetchPaidInvoices` / `fetchPaidInvoicesDirect`):
   `type = customerInvoice`, `amountPaid > 0`, open-job filter (unless
   `includeClosed`), **`issueDate` within `[From,To]`** — **no task-type filter**.
   Fields: `id, number, status, priceWithTax, amountPaid, issueDate,
   job{id,name,number}, task{name}`.

`fetchSoldJobIds` is unchanged and applies **only** to the scheduled set.

**Amount source:** `priceWithTax` for all three categories (consistent with current
code; in Titus paid invoices are fully paid so it equals `amountPaid`).

## Normalize / aggregate
- `normalize` gains: `paid` (`amountPaid > 0`), `category`
  (`'paid' | 'committed' | 'projected'`), and `expectedDate = paid ? issueDate :
  task.startDate`. Records with no effective date are dropped.
- `byMonth` entries gain a `paid` bucket beside `committed`/`projected`.
- Totals gain `paidTotal`; `grandTotal = paid + committed + projected`.

## Render
- **Bar stack** (bottom→top): Paid (solid green `#16a34a`) → Committed (solid teal
  `#0d9488`) → Projected (hatched amber `#f59e0b`). Data colors — **not** themed by
  Custom Theme.
- **Tiles:** Collected · Committed · Projected · Total · Invoices. When sold isn't
  configured: Collected · Scheduled · Total · Invoices.
- **Legend** gains "Paid (collected)". Hover tooltip, detail table, and CSV gain
  Paid as a third Type; the table date column uses `issueDate` for paid rows.
- Top tile relabels "Total forecast" → "Total (in window)".

## Touch list
- `server/jobtread-tools-pro/src/worker.js` (+ `wrangler deploy`)
- `JT-Tools-Master/features/invoice-forecast.js`
- `JT-Tools-Master/styles/invoice-forecast.css`
- `CHANGELOG.md`, `manifest.json` (version bump)

No new Cloudflare bindings, no new permissions, no popup/toggle changes (feature
already wired).

## Out of scope
- Partial-payment handling (`amountPaid` < `priceWithTax`) — not in Titus flow.
- Splitting Paid by sold/presale.
- Changing the default `From` window.
