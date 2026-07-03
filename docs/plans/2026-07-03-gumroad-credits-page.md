# Gumroad product page — Assistant Credit Packs

**Status:** Draft. This is a SEPARATE one-time Gumroad product (not variants on
the membership) — the purchase webhook routes top-ups by product_id before any
tier detection runs, so a $100 pack can never be misread as a license (see the
warning above `determineTier` in `server/license-proxy/src/worker.js`).
Crediting amounts are pinned in `server/mcp-server/src/agent-core/metering.js`
(`topupCreditsForPrice`) and tested — if pack pricing changes, change both in
the same PR. Publish alongside Phase 3 (webhook crediting); keep unpublished
for testing until then.

**Product setup:** one product, two variants — name them `2,000 Credits` and
`9,000 Credits` at $25 / $100. Names carry no tier keywords by design.

---

## Product name

**JT Power Tools — Assistant Credit Packs**

## Summary line

Extra fuel for your AI Assistant. One-time purchase, credits for your whole
company, and they never expire.

---

## Product description (main body)

Some months your team leans on the Assistant harder — month-end closeouts, a
big estimating push, three jobs closing the same week. Credit packs are for
exactly that.

Your Assistant subscription includes a monthly usage pool for your whole
company. If you burn through it, nothing breaks — the Assistant keeps
answering in reduced mode, and scheduled Playbooks simply wait. A credit pack
tops the tank back up instantly.

**How credits work:**

- Every Assistant answer uses a few credits — a typical question costs about
  5, a deep analysis more. Your plan includes 3,000 credits a month
  (Assistant) or 7,500 (Assistant Pro).
- Credit packs are **one-time purchases** that stack on top of your monthly
  pool. **They never expire** — buy a pack in July, use it in October.
- Credits are shared by your **whole company**, same as your subscription.
- **No overage charges, ever.** We will never surprise-bill you. If you run
  low, the Assistant tells you before it matters, and topping up is one click.

**Pick your pack:**

- **2,000 Credits — $25.** Roughly 400 extra questions. Right for a busy month.
- **9,000 Credits — $100.** Roughly 1,800 extra questions — a bulk-rate war
  chest for teams that run the Assistant all day. (Better per-credit price
  than the small pack.)

**Requirements:** an active Assistant or Assistant Pro subscription on the
same license. Buy with the same email you subscribed with and credits attach
to your company automatically within a few minutes.

## Common questions

**Do credits expire?** No. Top-up credits roll over until you use them. Your
monthly plan pool refreshes each billing cycle; packs sit on top.

**What happens if I never top up?** Nothing bad. Your monthly pool refreshes
every cycle. When it runs low the Assistant shifts to a lighter mode and
scheduled Playbooks pause until the new cycle — you're never cut off
mid-conversation and never billed extra.

**Who can buy?** Anyone on your team, but credits land on the company license
tied to the purchase email. One pool, whole company.

**Refunds?** Unused packs within 30 days, no questions.

---

## Variant descriptions (checkout one-liners)

- **2,000 Credits** — ~400 extra Assistant questions. One-time, never expires.
- **9,000 Credits** — ~1,800 extra questions at the bulk rate. One-time, never expires.
