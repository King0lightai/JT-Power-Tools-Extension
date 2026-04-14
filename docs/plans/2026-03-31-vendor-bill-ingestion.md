# Vendor Bill Ingestion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Users forward vendor invoices to `bills-{orgId}@jtpowertools.com`. The pipeline extracts and parks the data in a pending queue. When the user opens Claude and says "process my bills", their AI fetches the queue, applies the user's business rules (cost code mappings, vendor matching, job linking, approval thresholds), and calls `approve_bill` to create the document in JobTread. The user teaches the AI how to handle their bills — the pipeline just delivers the raw material.

**Architecture:** A Cloudflare Email Worker receives inbound emails, validates the sender allowlist, extracts the PDF, stores it in R2, parses text via `unpdf` + Workers AI, and writes a `pending` row to D1 — nothing goes to JobTread automatically. Six MCP tools give the AI the ability to list, inspect, approve (creating the JT draft document + attaching the PDF), reject, and manage the sender allowlist. The portal shows the forwarding address and an Approved Senders management section.

**Tech Stack:** Cloudflare Workers (email + fetch exports), Cloudflare D1, Cloudflare R2, Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct`), `postal-mime` (MIME parsing), `unpdf` (already installed — PDF text extraction), existing Pave API integration.

---

## How the AI Flexibility Works

The pending queue stores raw extracted data (vendor name, amount, line items, dates). The MCP tools expose this data to whatever AI the user is running. Because the AI decides when to call `approve_bill` and what parameters to pass, the user can give their AI standing instructions like:

- *"When you see a bill from ABC Lumber, always link it to job 3847 and use cost code Materials"*
- *"If the vendor doesn't exist in JobTread, create them as a vendor account first"*
- *"Never post a bill over $10,000 without confirming with me first"*
- *"Map line items containing 'labor' to cost type Labor, everything else to Materials"*

None of this logic lives in the pipeline — it lives in the user's AI conversation. The pipeline's only job is to park clean, structured data in the queue.

---

## Pre-Task: Cloudflare Infrastructure Setup

**Step 1: Create R2 bucket**

```bash
cd server/mcp-server
npx wrangler r2 bucket create jt-bills-storage
```

Expected: `Created bucket 'jt-bills-storage'`

**Step 2: Install postal-mime**

```bash
npm install postal-mime
```

---

## Task 1: D1 Migration — pending_bills + approved_senders

**Files:**
- Create: `server/mcp-server/migrations/011_vendor_bills.sql`

**Step 1: Write the migration**

```sql
-- Migration 011: Vendor Bill Ingestion
-- pending_bills: staging queue for inbound invoices awaiting AI review
-- approved_senders: per-org email allowlist for bill submission

CREATE TABLE IF NOT EXISTS pending_bills (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,

  -- Original email metadata
  from_email TEXT NOT NULL,
  original_filename TEXT,

  -- R2 storage key for the original PDF: {orgId}/{billId}.pdf
  r2_pdf_key TEXT,

  -- AI-extracted fields (all nullable — AI may not find everything)
  vendor_name TEXT,
  amount REAL,
  bill_date TEXT,       -- YYYY-MM-DD
  due_date TEXT,        -- YYYY-MM-DD
  line_items TEXT,      -- JSON array: [{description, quantity, unit_price, total}]
  job_reference TEXT,   -- any job/PO/project reference found on the invoice

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  reject_reason TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT,

  -- Populated after approve_bill posts to JobTread
  jobtread_document_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_bills_org_status
  ON pending_bills(org_id, status, created_at);

CREATE TABLE IF NOT EXISTS approved_senders (
  org_id TEXT NOT NULL,
  email TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (org_id, email)
);
```

**Step 2: Apply the migration**

```bash
npx wrangler d1 execute jobtread-extension-users --file=migrations/011_vendor_bills.sql --remote
```

Expected: `Executed 3 statements`

**Step 3: Verify**

```bash
npx wrangler d1 execute jobtread-extension-users \
  --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('pending_bills','approved_senders');" \
  --remote
```

Expected: 2 rows.

**Step 4: Commit**

```bash
git add server/mcp-server/migrations/011_vendor_bills.sql
git commit -m "feat: D1 migration — pending_bills queue and approved_senders allowlist"
```

---

## Task 2: Wrangler Config — R2 + Workers AI

**Files:**
- Modify: `server/mcp-server/wrangler.jsonc`

**Step 1: Add after the `kv_namespaces` block**

```jsonc
  // ─── R2 Buckets ────────────────────────────────────────────
  "r2_buckets": [
    {
      "binding": "BILLS_BUCKET",
      "bucket_name": "jt-bills-storage"
    }
  ],

  // ─── Workers AI ────────────────────────────────────────────
  "ai": {
    "binding": "AI"
  }
```

**Step 2: Verify**

```bash
npx wrangler deploy --dry-run
```

Expected: no errors, bindings list includes `BILLS_BUCKET` and `AI`.

**Step 3: Commit**

```bash
git add server/mcp-server/wrangler.jsonc server/mcp-server/package.json server/mcp-server/package-lock.json
git commit -m "feat: add R2 and Workers AI wrangler bindings, install postal-mime"
```

---

## Task 3: Email Handler Module — bills-handler.js

Receives the email, validates the sender, parks data in D1. **Does not touch JobTread.**

**Files:**
- Create: `server/mcp-server/src/bills-handler.js`

**Step 1: Write the module**

```javascript
/**
 * Vendor Bill Email Handler
 *
 * Ingest pipeline — parks data only, never writes to JobTread:
 *   1. Extract orgId from To address (bills-{orgId}@jtpowertools.com)
 *   2. Validate sender against approved_senders in D1
 *   3. Parse MIME, find PDF attachment
 *   4. Store PDF in R2
 *   5. Extract text via unpdf
 *   6. Extract structured data via Workers AI
 *   7. Write pending row to D1
 *
 * The AI (via MCP tools) decides what to do with the data.
 */

import PostalMime from 'postal-mime';
import { getDocumentProxy, extractText } from 'unpdf';

const MAX_PDF_SIZE = 15 * 1024 * 1024; // 15 MB
const EMAIL_ORG_PATTERN = /^bills-([a-zA-Z0-9_-]+)@/i;

export async function handleBillEmail(message, env) {
  // 1. Extract orgId from To address
  const orgId = extractOrgId(message.to);
  if (!orgId) {
    console.log(`BillsHandler: Dropping — unrecognized To: ${message.to}`);
    return;
  }

  // 2. Validate sender
  const senderEmail = (message.from || '').toLowerCase().trim();
  const allowed = await isSenderAllowed(env.DB, orgId, senderEmail);
  if (!allowed) {
    console.log(`BillsHandler: Dropping — sender not approved: ${senderEmail} (org: ${orgId})`);
    return;
  }

  // 3. Parse raw MIME
  let parsed;
  try {
    const rawBytes = await streamToArrayBuffer(message.raw);
    parsed = await PostalMime.parse(rawBytes);
  } catch (e) {
    console.error(`BillsHandler: MIME parse failed (org ${orgId}):`, e.message);
    return;
  }

  // 4. Find PDF attachment
  const pdfAttachment = findPdfAttachment(parsed);
  if (!pdfAttachment) {
    console.log(`BillsHandler: No PDF in email from ${senderEmail} (org ${orgId}) — dropping`);
    return;
  }

  const pdfBytes = pdfAttachment.content; // ArrayBuffer
  if (pdfBytes.byteLength > MAX_PDF_SIZE) {
    console.log(`BillsHandler: PDF too large (${pdfBytes.byteLength} bytes) — dropping`);
    return;
  }

  // 5. Store PDF in R2
  const billId = generateId();
  const r2Key = `${orgId}/${billId}.pdf`;
  const originalFilename = pdfAttachment.filename || 'invoice.pdf';

  try {
    await env.BILLS_BUCKET.put(r2Key, pdfBytes, {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: { orgId, billId, originalName: originalFilename },
    });
  } catch (e) {
    console.error(`BillsHandler: R2 put failed for ${r2Key}:`, e.message);
    return;
  }

  // 6. Extract text from PDF
  let pdfText = '';
  try {
    const pdf = await getDocumentProxy(new Uint8Array(pdfBytes));
    const { text } = await extractText(pdf, { mergePages: true });
    pdfText = text.slice(0, 8000);
  } catch (e) {
    console.warn(`BillsHandler: PDF text extraction failed for ${billId}:`, e.message);
  }

  // 7. Extract structured fields via Workers AI
  const extracted = await extractBillData(env.AI, pdfText, originalFilename);

  // 8. Write pending row to D1
  try {
    await env.DB.prepare(`
      INSERT INTO pending_bills (
        id, org_id, from_email, original_filename, r2_pdf_key,
        vendor_name, amount, bill_date, due_date, line_items,
        job_reference, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).bind(
      billId, orgId, senderEmail, originalFilename, r2Key,
      extracted.vendor_name || null,
      extracted.amount || null,
      extracted.bill_date || null,
      extracted.due_date || null,
      JSON.stringify(extracted.line_items || []),
      extracted.job_reference || null,
      new Date().toISOString(),
    ).run();

    console.log(`BillsHandler: Queued bill ${billId} (org ${orgId}, vendor: ${extracted.vendor_name})`);
  } catch (e) {
    console.error(`BillsHandler: D1 insert failed for ${billId}:`, e.message);
    await env.BILLS_BUCKET.delete(r2Key).catch(() => {});
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function extractOrgId(toAddress) {
  const match = (toAddress || '').match(EMAIL_ORG_PATTERN);
  return match ? match[1] : null;
}

async function isSenderAllowed(db, orgId, email) {
  const row = await db
    .prepare('SELECT 1 FROM approved_senders WHERE org_id = ? AND email = ? LIMIT 1')
    .bind(orgId, email.toLowerCase())
    .first();
  return row !== null;
}

function findPdfAttachment(parsed) {
  return (parsed.attachments || []).find(a =>
    a.mimeType === 'application/pdf' ||
    (a.filename || '').toLowerCase().endsWith('.pdf')
  ) || null;
}

async function streamToArrayBuffer(stream) {
  const chunks = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out.buffer;
}

async function extractBillData(ai, pdfText, filename) {
  const fallback = {
    vendor_name: null, amount: null, bill_date: null, due_date: null,
    line_items: [], job_reference: null,
  };
  if (!pdfText.trim()) return fallback;

  const prompt = `Extract the following fields from this vendor invoice and return ONLY valid JSON with no extra text:
{
  "vendor_name": "string or null",
  "amount": number or null (total amount due),
  "bill_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "job_reference": "string or null (any job number, PO, or project reference found on the invoice)",
  "line_items": [{"description": "string", "quantity": number_or_null, "unit_price": number_or_null, "total": number_or_null}]
}

Filename: ${filename}
Invoice text:
${pdfText}`;

  try {
    const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', { prompt, max_tokens: 512 });
    const raw = (response?.response || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    return { ...fallback, ...JSON.parse(jsonMatch[0]) };
  } catch (e) {
    console.warn(`BillsHandler: AI extraction failed — storing with empty fields:`, e.message);
    return fallback;
  }
}

function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(b => chars[b % chars.length]).join('');
}
```

**Step 2: Commit**

```bash
git add server/mcp-server/src/bills-handler.js
git commit -m "feat: email handler — validate sender, extract PDF, park in D1 pending queue"
```

---

## Task 4: Add email Export to index.js

**Files:**
- Modify: `server/mcp-server/src/index.js`

**Step 1: Add import at the top with other imports**

```javascript
import { handleBillEmail } from './bills-handler.js';
```

**Step 2: Restructure the default export**

The file currently ends with `export default new OAuthProvider({...})`. Change to:

```javascript
const oauthProvider = new OAuthProvider({
  // ...exact same config as before, unchanged...
});

export default {
  // HTTP handler (MCP, REST, OAuth) — unchanged behavior
  fetch(request, env, ctx) {
    return oauthProvider.fetch(request, env, ctx);
  },

  // Email routing — inbound vendor bill ingestion
  async email(message, env, ctx) {
    ctx.waitUntil(handleBillEmail(message, env));
  },
};
```

**Step 3: Verify**

```bash
npx wrangler deploy --dry-run
```

Expected: no errors.

**Step 4: Commit**

```bash
git add server/mcp-server/src/index.js
git commit -m "feat: add email export to Worker for inbound vendor bill routing"
```

---

## Task 5: Six Bill MCP Tools in tools.js

The AI uses these to fetch pending data, inspect it, then decide how to call `approve_bill` based on the user's instructions.

**Files:**
- Modify: `server/mcp-server/src/tools.js`

### 5A: Handler functions

Add immediately before the `TOOL_DEFINITIONS` export:

```javascript
// ═══════════════════════════════════════════════════════════════════
// VENDOR BILL INGESTION TOOLS
// ═══════════════════════════════════════════════════════════════════

async function handleListPendingBills({ status = 'pending', limit = 25 }, ctx) {
  const validStatuses = ['pending', 'approved', 'rejected', 'all'];
  if (!validStatuses.includes(status)) throw new Error(`status must be one of: ${validStatuses.join(', ')}`);

  const whereClauses = ['org_id = ?'];
  const binds = [ctx.orgId];

  if (status !== 'all') {
    whereClauses.push('status = ?');
    binds.push(status);
  }

  binds.push(Math.min(limit, 100));

  const { results } = await ctx.env.DB.prepare(
    `SELECT id, from_email, original_filename, vendor_name, amount,
            bill_date, due_date, job_reference, status, created_at, jobtread_document_id
     FROM pending_bills
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY created_at DESC LIMIT ?`
  ).bind(...binds).all();

  return {
    bills: results.map(b => ({ ...b, amount: b.amount != null ? Number(b.amount) : null })),
    count: results.length,
    note: status === 'pending' && results.length > 0
      ? 'Use get_pending_bill_detail to see line items before approving.'
      : undefined,
  };
}

async function handleGetPendingBillDetail({ billId }, ctx) {
  const bill = await ctx.env.DB.prepare(
    'SELECT * FROM pending_bills WHERE id = ? AND org_id = ? LIMIT 1'
  ).bind(billId, ctx.orgId).first();

  if (!bill) throw new Error(`Bill not found: ${billId}`);

  return {
    ...bill,
    amount: bill.amount != null ? Number(bill.amount) : null,
    line_items: bill.line_items ? JSON.parse(bill.line_items) : [],
    pdf_stored: !!bill.r2_pdf_key,
  };
}

async function handleApproveBill({ billId, jobId, accountId, overrides }, ctx) {
  // 1. Fetch the pending bill
  const bill = await ctx.env.DB.prepare(
    'SELECT * FROM pending_bills WHERE id = ? AND org_id = ? LIMIT 1'
  ).bind(billId, ctx.orgId).first();

  if (!bill) throw new Error(`Bill not found: ${billId}`);
  if (bill.status !== 'pending') throw new Error(`Bill is already ${bill.status}`);

  // 2. Resolve final field values — AI-provided overrides win over extracted data
  const vendorName = overrides?.vendor_name || bill.vendor_name || 'Unknown Vendor';
  const issueDate  = overrides?.bill_date   || bill.bill_date   || null;
  const dueDate    = overrides?.due_date    || bill.due_date    || null;

  // 3. Build description from extracted line items (for JobTread document body)
  const lineItems  = overrides?.line_items  ||
    (bill.line_items ? JSON.parse(bill.line_items) : []);

  const descriptionLines = ['Imported via JT Power Tools'];
  if (bill.original_filename) descriptionLines.push(`File: ${bill.original_filename}`);
  if (bill.from_email)        descriptionLines.push(`From: ${bill.from_email}`);
  if (lineItems.length) {
    descriptionLines.push('', 'Line items:');
    for (const item of lineItems) {
      const parts = [item.description];
      if (item.total != null) parts.push(`$${Number(item.total).toFixed(2)}`);
      descriptionLines.push(`  - ${parts.join(' — ')}`);
    }
  }

  // 4. Create vendorBill document in JobTread via Pave
  const docData = await ctx.pave({
    createDocument: {
      $: {
        organizationId: ctx.orgId,
        type: 'vendorBill',
        name: vendorName,
        ...(jobId     ? { jobId }     : {}),
        ...(accountId ? { accountId } : {}),
        ...(issueDate ? { issueDate } : {}),
        ...(dueDate   ? { dueDate }   : {}),
        description: descriptionLines.join('\n'),
      },
      createdDocument: { id: {}, name: {}, number: {}, type: {} },
    },
  });

  const doc = docData.createDocument?.createdDocument;
  if (!doc?.id) throw new Error('createDocument returned no ID — check Pave mutation');

  // 5. Attach original PDF to the document (fire and forget — don't fail approve on upload error)
  let pdfAttached = false;
  if (bill.r2_pdf_key) {
    try {
      pdfAttached = await attachPdfToDocument(ctx, doc.id, bill.r2_pdf_key, bill.original_filename || 'invoice.pdf');
    } catch (e) {
      console.warn(`ApproveBill: PDF attach failed for ${billId} (continuing):`, e.message);
    }
  }

  // 6. Mark approved in D1
  await ctx.env.DB.prepare(
    `UPDATE pending_bills
     SET status = 'approved', processed_at = ?, jobtread_document_id = ?
     WHERE id = ?`
  ).bind(new Date().toISOString(), doc.id, billId).run();

  return {
    success: true,
    billId,
    jobtreadDocumentId: doc.id,
    documentName: doc.name,
    documentNumber: doc.number,
    pdfAttached,
    message: `Draft vendorBill created in JobTread${pdfAttached ? ' with PDF attached' : ''}. A human can now review and approve it in JobTread.`,
  };
}

async function attachPdfToDocument(ctx, documentId, r2Key, filename) {
  const r2Object = await ctx.env.BILLS_BUCKET.get(r2Key);
  if (!r2Object) return false;

  const pdfBytes = await r2Object.arrayBuffer();

  // Create upload request
  const uploadData = await ctx.pave({
    createUploadRequest: {
      $: { organizationId: ctx.orgId, size: pdfBytes.byteLength, type: 'application/pdf' },
      createdUploadRequest: { id: {}, url: {}, method: {}, headers: {} },
    },
  });

  const req = uploadData.createUploadRequest?.createdUploadRequest;
  if (!req) return false;

  // PUT to signed URL
  const headers = {};
  if (req.headers && typeof req.headers === 'object') {
    for (const [k, v] of Object.entries(req.headers)) headers[k] = v;
  }
  const uploadResp = await fetch(req.url, { method: req.method || 'PUT', headers, body: pdfBytes });
  if (!uploadResp.ok) throw new Error(`Upload PUT failed: ${uploadResp.status}`);

  // Attach via comment on the document
  await ctx.pave({
    createComment: {
      $: {
        targetId: documentId,
        targetType: 'document',
        message: `Original invoice: ${filename}`,
        files: [{ uploadRequestId: req.id, name: filename }],
      },
      createdComment: { id: {} },
    },
  });

  return true;
}

async function handleRejectBill({ billId, reason }, ctx) {
  const bill = await ctx.env.DB.prepare(
    'SELECT id, status FROM pending_bills WHERE id = ? AND org_id = ? LIMIT 1'
  ).bind(billId, ctx.orgId).first();

  if (!bill) throw new Error(`Bill not found: ${billId}`);
  if (bill.status !== 'pending') throw new Error(`Bill is already ${bill.status}`);

  await ctx.env.DB.prepare(
    `UPDATE pending_bills SET status = 'rejected', reject_reason = ?, processed_at = ? WHERE id = ?`
  ).bind(reason || null, new Date().toISOString(), billId).run();

  return { success: true, billId, message: 'Bill rejected.' };
}

async function handleListApprovedSenders(_args, ctx) {
  const { results } = await ctx.env.DB.prepare(
    'SELECT email, added_at FROM approved_senders WHERE org_id = ? ORDER BY added_at DESC'
  ).bind(ctx.orgId).all();

  return {
    senders: results,
    count: results.length,
    forwardingAddress: `bills-${ctx.orgId}@jtpowertools.com`,
  };
}

async function handleAddApprovedSender({ email }, ctx) {
  const normalized = email.toLowerCase().trim();
  if (!normalized.includes('@')) throw new Error('Invalid email address');

  await ctx.env.DB.prepare(
    'INSERT OR IGNORE INTO approved_senders (org_id, email, added_at) VALUES (?, ?, ?)'
  ).bind(ctx.orgId, normalized, new Date().toISOString()).run();

  return {
    success: true,
    email: normalized,
    forwardingAddress: `bills-${ctx.orgId}@jtpowertools.com`,
    message: `${normalized} added to approved senders. They can now forward invoices to bills-${ctx.orgId}@jtpowertools.com`,
  };
}
```

### 5B: TOOL_DEFINITIONS entries

Add to the `TOOL_DEFINITIONS` array:

```javascript
  // ─── Vendor Bill Ingestion ────────────────────────────────────
  {
    name: 'list_pending_bills',
    description: 'List vendor bills in the ingestion queue. Pending bills have been extracted from email and are waiting for the AI to review and post to JobTread. Use get_pending_bill_detail to see line items before approving.',
    annotations: { readOnlyHint: true },
    schema: {
      status: z.enum(['pending', 'approved', 'rejected', 'all']).optional()
        .describe('Filter by status. Default: pending'),
      limit: z.number().optional().describe('Max results (default 25, max 100)'),
    },
    handler: handleListPendingBills,
    restPath: '/api/bills/list',
  },
  {
    name: 'get_pending_bill_detail',
    description: 'Get full detail for a single pending bill including AI-extracted line items. Review this before calling approve_bill so you can apply the correct job, account, and any field corrections.',
    annotations: { readOnlyHint: true },
    schema: {
      billId: z.string().describe('Bill ID from list_pending_bills'),
    },
    handler: handleGetPendingBillDetail,
    restPath: '/api/bills/get',
  },
  {
    name: 'approve_bill',
    description: 'Create a draft vendorBill document in JobTread from a pending bill and attach the original PDF. The bill is marked approved in the queue. A human can then review and finalize it in JobTread. Use overrides to correct any AI extraction errors before posting.',
    schema: {
      billId: z.string().describe('Bill ID to approve'),
      jobId: z.string().optional().describe('JobTread job ID to link this bill to'),
      accountId: z.string().optional().describe('JobTread vendor account ID. If omitted, document is created without a vendor.'),
      overrides: z.object({
        vendor_name: z.string().optional().describe('Override extracted vendor name'),
        bill_date: z.string().optional().describe('Override extracted issue date (YYYY-MM-DD)'),
        due_date: z.string().optional().describe('Override extracted due date (YYYY-MM-DD)'),
        line_items: z.array(z.object({
          description: z.string(),
          quantity: z.number().optional(),
          unit_price: z.number().optional(),
          total: z.number().optional(),
        })).optional().describe('Override extracted line items'),
      }).optional().describe('Override any AI-extracted fields before posting to JobTread'),
    },
    handler: handleApproveBill,
    restPath: '/api/bills/approve',
  },
  {
    name: 'reject_bill',
    description: 'Reject a pending bill — marks it rejected in the queue without posting to JobTread.',
    schema: {
      billId: z.string().describe('Bill ID to reject'),
      reason: z.string().optional().describe('Reason for rejection (stored for audit)'),
    },
    handler: handleRejectBill,
    restPath: '/api/bills/reject',
  },
  {
    name: 'list_approved_senders',
    description: 'List email addresses approved to submit vendor bills for this org. Emails from non-approved senders are silently dropped.',
    annotations: { readOnlyHint: true },
    schema: {},
    handler: handleListApprovedSenders,
    restPath: '/api/bills/senders/list',
  },
  {
    name: 'add_approved_sender',
    description: 'Add an email address to the vendor bill sender allowlist. Returns the forwarding address to give to the sender.',
    schema: {
      email: z.string().describe('Email address to approve for bill submission'),
    },
    handler: handleAddApprovedSender,
    restPath: '/api/bills/senders/add',
  },
```

> **Note on ctx.env:** The new handlers use `ctx.env.DB` and `ctx.env.BILLS_BUCKET`. Find where `ctx` is constructed in `index.js` inside `handleMcpStreamable`. If `env` isn't already on `ctx`, add it: `const ctx = { orgId, pave, grantKey, env, ... }`.

**Step 3: Verify build**

```bash
npx wrangler deploy --dry-run
```

**Step 4: Commit**

```bash
git add server/mcp-server/src/tools.js
git commit -m "feat: add 6 vendor bill MCP tools (list, detail, approve, reject, senders)"
```

---

## Task 6: Portal Dashboard — Forwarding Address + Approved Senders

**Files:**
- Modify: `portal/dashboard.html`
- Modify: `server/mcp-server/src/rest-handler.js`

### 6A: Forwarding address display

In `dashboard.html`, after the `grantKeyStatus` div, add:

```html
<!-- Vendor Bill Forwarding Address — shown when grant key is valid -->
<div id="billForwardingSection" class="hidden" style="margin-top: 16px; padding: 14px 16px; background: var(--bg-card); border: 1px solid var(--border-light); border-radius: var(--radius-sm);">
  <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Vendor Bill Forwarding</div>
  <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 6px;">Forward vendor invoices (PDF) to this address. Your AI will process them on demand.</div>
  <div style="display: flex; align-items: center; gap: 8px;">
    <span id="billForwardingAddress" style="font-family: monospace; font-size: 13px; color: var(--text-primary); background: var(--bg-input); padding: 6px 10px; border-radius: var(--radius-xs); border: 1px solid var(--border-light); flex: 1;"></span>
    <button onclick="copyForwardingAddress()" style="padding: 6px 12px; background: var(--bg-elevated); border: 1px solid var(--border-light); border-radius: var(--radius-xs); color: var(--text-secondary); font-size: 12px; cursor: pointer;">Copy</button>
  </div>
</div>
```

In the JS (inside `loadDashboard`, after showing the grant key org), add:

```javascript
const orgId = data.grantKey?.org?.id;
if (orgId && data.grantKey.configured && data.grantKey.valid) {
  document.getElementById('billForwardingAddress').textContent = `bills-${orgId}@jtpowertools.com`;
  document.getElementById('billForwardingSection').classList.remove('hidden');
}
```

Copy helper (add as a standalone function):

```javascript
function copyForwardingAddress() {
  const addr = document.getElementById('billForwardingAddress').textContent;
  navigator.clipboard.writeText(addr).then(() => {
    const btn = event.target;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}
```

### 6B: Approved Senders section

Add after the last major dashboard section (Owner/Admin only):

```html
<section id="approvedSendersSection" class="hidden card" style="margin-top: 24px;">
  <div class="card-header">
    <h2>Approved Bill Senders</h2>
    <span class="badge" id="sendersBadge">—</span>
  </div>
  <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
    Only emails from these addresses will be accepted for vendor bill ingestion. All others are silently dropped.
  </p>
  <div id="sendersList" style="margin-bottom: 16px;"></div>
  <div style="display: flex; gap: 8px; align-items: center;">
    <input type="email" id="newSenderEmail" placeholder="vendor@example.com"
      style="flex: 1; padding: 10px 14px; background: var(--bg-input); border: 1px solid var(--border-light); border-radius: var(--radius-sm); color: var(--text-primary); font-size: 14px; outline: none;">
    <button class="btn btn-primary" onclick="addApprovedSender()">Add Sender</button>
  </div>
  <div id="senderAlert" class="hidden" style="margin-top: 12px; padding: 10px 14px; border-radius: var(--radius-sm); font-size: 13px;"></div>
</section>
```

JS functions:

```javascript
async function loadApprovedSenders() {
  try {
    const data = await api.get('/admin/bills/senders');
    document.getElementById('sendersBadge').textContent = data.senders.length;
    const list = document.getElementById('sendersList');
    if (!data.senders.length) {
      list.innerHTML = '<p style="font-size: 13px; color: var(--text-dim);">No approved senders yet. Add one below.</p>';
      return;
    }
    list.innerHTML = `<table class="data-table"><thead><tr><th>Email</th><th>Added</th></tr></thead><tbody>
      ${data.senders.map(s => `<tr><td>${esc(s.email)}</td><td>${new Date(s.added_at).toLocaleDateString()}</td></tr>`).join('')}
    </tbody></table>`;
  } catch (e) { console.error('Failed to load approved senders:', e); }
}

async function addApprovedSender() {
  const email = document.getElementById('newSenderEmail').value.trim();
  const alertEl = document.getElementById('senderAlert');
  if (!email) return;
  try {
    await api.post('/admin/bills/senders/add', { email });
    document.getElementById('newSenderEmail').value = '';
    showAlert(alertEl, `${email} added.`, 'success');
    loadApprovedSenders();
  } catch (e) {
    showAlert(alertEl, e.message || 'Failed to add sender.', 'error');
  }
}
```

In `loadDashboard`:

```javascript
if (currentUser?.role === 'owner' || currentUser?.role === 'admin') {
  document.getElementById('approvedSendersSection').classList.remove('hidden');
  loadApprovedSenders();
}
```

### 6C: REST routes in rest-handler.js

Find the `/admin/` route handler block and add:

```javascript
if (path === '/admin/bills/senders' && method === 'GET') {
  const { results } = await env.DB.prepare(
    'SELECT email, added_at FROM approved_senders WHERE org_id = ? ORDER BY added_at DESC'
  ).bind(authResult.license.orgId).all();
  return jsonResponse({ senders: results });
}

if (path === '/admin/bills/senders/add' && method === 'POST') {
  const { email } = await request.json();
  if (!email || !email.includes('@')) return jsonResponse({ error: 'Invalid email' }, 400);
  const normalized = email.toLowerCase().trim();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO approved_senders (org_id, email, added_at) VALUES (?, ?, ?)'
  ).bind(authResult.license.orgId, normalized, new Date().toISOString()).run();
  return jsonResponse({ success: true, email: normalized });
}
```

**Step 4: Commit**

```bash
git add portal/dashboard.html server/mcp-server/src/rest-handler.js
git commit -m "feat: add bill forwarding address display and approved senders UI to portal"
```

---

## Task 7: CHANGELOG + Deploy + Email Routing Config

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add CHANGELOG entry under [Unreleased]**

```markdown
## [Unreleased]

### Added
#### Vendor Bill Ingestion
- Added vendor bill ingestion pipeline via Cloudflare Email Routing
  - Forward vendor invoices (PDF) to `bills-{orgId}@jtpowertools.com`
  - Per-org sender allowlist — unauthorized senders are silently dropped
  - AI (Workers AI) extracts vendor name, amount, dates, and line items into a pending queue
  - Original PDF stored in Cloudflare R2 for attachment when approved
  - Nothing is posted to JobTread automatically — the user's AI processes the queue on demand
- Added 6 MCP tools for bill pipeline management:
  - `list_pending_bills` — view bills queued from email
  - `get_pending_bill_detail` — full extracted data + line items for a single bill
  - `approve_bill` — create a draft vendorBill in JobTread with PDF attached (AI-driven, with override support)
  - `reject_bill` — dismiss a bill with optional reason
  - `list_approved_senders` — view email allowlist
  - `add_approved_sender` — add an email to the allowlist
- Added vendor bill forwarding address display to portal dashboard
- Added Approved Senders management section to portal dashboard (Owner/Admin only)
```

**Step 2: Deploy**

```bash
cd server/mcp-server
npx wrangler deploy
```

**Step 3: Configure Cloudflare Email Routing**

In the Cloudflare dashboard for `jtpowertools.com`:
1. Go to **Email > Email Routing** — ensure it is **Enabled**
2. Add a **Catch-all** rule: Action = **Send to Worker**, Worker = `jobtread-mcp-server`

This catches all `bills-*@jtpowertools.com` addresses dynamically.

**Step 4: Smoke test end-to-end**

```
1. Via portal or MCP: add_approved_sender("your@email.com")
2. Forward a test PDF invoice to bills-{yourOrgId}@jtpowertools.com
3. Wait ~10s, then via Claude:
     "do I have any pending bills?"
     → list_pending_bills returns 1 result
     "show me the details"
     → get_pending_bill_detail returns extracted fields + line items
     "approve it, link it to job [X]"
     → approve_bill creates draft vendorBill in JobTread
4. Open JobTread → Documents → verify draft vendorBill exists with PDF attached
```

**Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for vendor bill ingestion feature"
```

---

## Gotchas & Notes

### ctx.env in tool handlers
New handlers need `ctx.env.DB` and `ctx.env.BILLS_BUCKET`. Find the `ctx` construction in `index.js` inside `handleMcpStreamable` and add `env` if it isn't already there.

### Cloudflare Email Routing domain
Email Routing requires `jtpowertools.com` to be managed by Cloudflare DNS (nameservers pointing to Cloudflare). Confirm this before Task 7 Step 3.

### Workers AI JSON extraction
The regex `\{[\s\S]*\}` handles model preamble text. If extraction quality is poor on real invoices, switch the model to `@cf/mistral/mistral-7b-instruct-v0.1` or tighten the prompt.

### createDocument Pave mutation
Follows the same pattern as `createJob` (returns `createdDocument`). The `type: 'vendorBill'` is a confirmed valid enum value. `accountId` should be a vendor-type account — the AI should search for or create the vendor account before calling `approve_bill`.

### approve_bill is intentionally flexible
The tool accepts `jobId`, `accountId`, and `overrides` as optional — the AI fills these in based on the user's instructions. If a user says "always link ABC Supply to job 1234", the AI provides `jobId` on its own. The tool doesn't enforce any of this — that intelligence lives in the conversation.
