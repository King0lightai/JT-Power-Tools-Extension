# Agent Webhooks

Connect your own AI agent — or any HTTP service — to Power Tools events.
When something happens in your org (e.g. a vendor bill is received), we POST
a signed JSON payload to a URL you control. Your agent does the rest.

## How it works

```
Event source (e.g. handleBillEmail)
        │
        ▼
   enqueueEvent
        │
        ▼
Cloudflare Queue ───► dispatchDelivery ───► POST https://your-agent.example
                                                     X-Power-Tools-Signature
```

- Power Tools fires events when something interesting happens.
- You subscribe a webhook URL to one or more events in the
  **Automations** section of the portal.
- We deliver each event as an HTTPS POST with an HMAC-SHA256 signature.
- 5xx responses are retried automatically (up to 5 attempts, exponential
  backoff). 4xx responses are recorded but not retried — fix your endpoint.

## Setting up a subscription

1. Open the portal → **Automations** tab.
2. Click **New connection**.
3. Pick an event (e.g. `bill.received`), the JT org it should fire for,
   and the HTTPS URL of your agent.
4. We generate a signing secret and show it **once**. Copy it into your
   agent's environment immediately — Power Tools stores only a hash and
   cannot recover the raw value.
5. Click **Test** on the row to fire a synthetic delivery and confirm
   your agent answers 2xx.

## Payload contract

Every delivery is a POST with `Content-Type: application/json`:

```json
{
  "event":       "bill.received",
  "version":     "1",
  "delivery_id": "del_3f2a…",
  "occurred_at": "2026-05-20T14:32:00Z",
  "org_id":      "abc123",
  "data":        { "bill_id": "bill_xyz" }
}
```

`data` carries IDs only. To pull the full record (PDF, vendor, totals),
call the corresponding MCP tool — for `bill.received`, that's
`get_pending_bill_detail` with `bill_id`. This keeps the webhook body
tiny and forces the access-control path through MCP / OAuth rather than
baking PII into webhook bodies.

### Test deliveries

`POST /admin/agent-connections/test` (the **Test** button) fires the same
shape, but `data.test = true`. Your agent should no-op when it sees this
flag — return 200 OK without writing to JobTread.

## Verifying signatures

Each request carries:

| Header | Value |
|---|---|
| `X-Power-Tools-Event` | The event id (e.g. `bill.received`) |
| `X-Power-Tools-Delivery-Id` | Unique per delivery — use for idempotency |
| `X-Power-Tools-Timestamp` | Unix seconds when we signed the payload |
| `X-Power-Tools-Signature` | `sha256=<hex>` of HMAC over `${timestamp}.${rawBody}` |

Reject anything that doesn't pass these three checks:

1. The timestamp is within 5 minutes of now (clock skew tolerance).
2. The signature matches your computed HMAC.
3. You haven't already processed this `delivery_id` (idempotency).

### Cloudflare Worker — Node — Deno

```js
export default {
  async fetch(request, env) {
    const body = await request.text();
    const ts = request.headers.get('X-Power-Tools-Timestamp');
    const sig = request.headers.get('X-Power-Tools-Signature');
    if (!ts || !sig) return new Response('missing signature', { status: 400 });

    // Reject stale deliveries
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
      return new Response('stale', { status: 400 });
    }

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.POWER_TOOLS_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${ts}.${body}`),
    );
    const expected = 'sha256=' +
      Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');

    if (expected !== sig) return new Response('bad signature', { status: 401 });

    const evt = JSON.parse(body);
    if (evt.data?.test) return new Response('ok (test)', { status: 200 });

    // Hand off to your agent. Return 2xx promptly — long work belongs in
    // a follow-up queue, not on the webhook reply.
    ctx.waitUntil(processEvent(evt, env));
    return new Response('ok', { status: 200 });
  },
};
```

```js
// Node (Express)
import crypto from 'node:crypto';

app.post('/power-tools', express.text({ type: 'application/json' }), (req, res) => {
  const ts = req.get('X-Power-Tools-Timestamp');
  const sig = req.get('X-Power-Tools-Signature');
  if (!ts || !sig) return res.sendStatus(400);
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return res.sendStatus(400);

  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.POWER_TOOLS_SECRET)
    .update(`${ts}.${req.body}`)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
    return res.sendStatus(401);
  }

  const evt = JSON.parse(req.body);
  if (evt.data?.test) return res.sendStatus(200);

  // Enqueue downstream work
  queue.publish(evt);
  res.sendStatus(200);
});
```

## Retry behavior

| Response from your agent | What Power Tools does |
|---|---|
| 2xx | Mark success, done |
| 4xx | Mark failed, no retry (fix your endpoint) |
| 5xx or network error | Retry with exponential backoff, up to 5 attempts |
| Timeout (> 10s) | Same as network error — retried |

After 5 failed attempts the message lands in the dead-letter queue. The
portal **Log** view shows the last 50 delivery attempts per connection
with response codes and error messages.

## Event catalog (v1)

| Event | Fires when | `data` shape |
|---|---|---|
| `bill.received` | A vendor bill PDF arrives at the org's ingestion address and is queued in `pending_bills` | `{ bill_id }` — pull detail via `get_pending_bill_detail` |

More events ship over time. The list above is canonical — `GET
/admin/agent-connections/events` returns the live catalog programmatically.

## Rotating secrets

Click **Rotate** (the circular-arrows icon) on a connection row. We
issue a new signing secret and invalidate the old one immediately —
update your agent's environment without delay.

## Pausing vs. deleting

**Pause** keeps the connection but stops delivering — useful when you're
shipping your agent and don't want events to fire during the deploy.
**Delete** removes the connection and its delivery history.

## Tier

Automations require the **Power User** tier. The portal hides the section
for ineligible users; the server enforces the gate on every API call.
