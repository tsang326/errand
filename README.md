# Errand

A shopping agent you can audit. You type one sentence; it searches real retailers, then
**rules on every product against every requirement it found in your words** and shows its
work as a ledger. You buy the goods at the shop; you pay Errand, with PayPal, for the search.

**Live demo:** https://errand-46ur.onrender.com

> The demo runs PayPal in **sandbox**, so no real money moves. Errand does not sell the
> goods and never places an order with a retailer — Channel3 ships no checkout endpoint, and
> an agent buying on a shop's site for you is a thing this app refuses to be. The products
> are bought at the retailer through the tracked link in each row, which is also where
> Errand earns a commission. What PayPal pays for here is the agent's own work: a **pass**
> of 25 errands for $3.00, spent one search at a time, refundable for the part you do not
> use. Prices and stock are the product index's snapshot, not the retailer's page at the
> moment you read it — each row links to the listing so you can check.

## The idea

Most shopping agents answer with a ranked list and a confidence score. A score cannot be
checked: you cannot tell whether 87% means the lamp is dimmable or that the model liked the
photo. Errand never puts one on the screen: a percentage is derived from the marks and kept in
the payload, so it can never disagree with them, and the marks are what you read.

Instead the sentence becomes **columns**:

```
"I need a desk lamp under $60 that does not glare on a second monitor
 and has a warm setting for the evening"

   Product                    │ does not glare on │ has a warm setting │ Price
                              │ a second monitor  │ for the evening    │
   ───────────────────────────┼───────────────────┼────────────────────┼────────
   Minimalist Tunable LED      │     holds         │     holds          │ $36.04
   LED Desk Lamp with Clip     │ the index does    │     holds          │ $27.99
                               │ not say           │                    │
```

Each cell is one of three marks — **holds**, **the index does not say**, **fails** — with
the sentence that decided it. The header is the buyer's own wording, not a retailer's facet.
"3 of 24 hold all 2 of your requirements" is derived from the marks, so the number on screen
and the marks under it can never disagree.

The marks are about **the product index's entry**, not about the retailer's page: the agent
reads what Channel3 holds — title, description, materials, attributes, key features, variants
and the cheapest offer — and never opens the retailer's own page. The wording on screen says
so, because a silence we caused and a silence the retailer caused are not the same fact.

"The index does not say" is the mark that matters. Most of what people actually ask for is
not recorded anywhere in a product listing, and an agent that collapses silence into a yes or
a no is inventing the answer.

The price on a row is the cheapest in-stock offer the index holds, and the index often
holds others that are nothing like it: the same sealed booster box came back at $120 on
stockx.com, $304.17 on bestbuy.com and $422.37 on kickscrew.com. The cell says "cheapest of
3, to $422.37" and the row's sheet lists every offer with its own link, so one number never
stands in for a 3.5x spread.

And before any money is proposed, the ticked rows are re-read against Channel3's **price
tracking** history (`GET /v0/price-tracking/history/{id}`) — a different endpoint family,
used deliberately to check the first one rather than to trust it. The two can disagree: on
2026-11-04 `/search` served that booster box at $120 while its own tracked history had
stepped to $304.17 on 31 October. When they disagree, the pay bar says so, naming both
figures and the date, and does not block anything: the shopper decides.

Two other numbers are deliberately absent. There is no fit percentage. And there is no
struck-through "was" price: Channel3's `compareAtPrice` is not a figure the product was on
sale from — on 2026-11-04 the index offered a One Piece booster box at "$120 ~~$269~~" while
StockX's own page asked $219, $120 being the box's printed retail — so the figure is not
shown at all, and the caveat above the grid says which number the price is.

## How it works

```
sentence ──▶ planSearch ──▶ Channel3 /v1/search ──▶ rankProducts ──▶ ledger
            (gpt-4.1)       mode: agentic, 24 rows   (gpt-4.1)       │
                                                                     ▼
                                              ticked rows ──▶ PayPal Orders v2
```

1. **`planSearch`** turns the sentence into a query, a price ceiling, and the list of
   requirements to judge against — the buyer's own phrases, kept verbatim.
2. **Channel3** `POST /v1/search` in `agentic` mode returns up to 24 real products with
   offers, prices, stock and a buy link. Without a key the server answers from bundled
   fixtures and labels every response `origin: "fixture"`, so a demo is never a grid of
   invented products that looks exactly like a grid of real ones.
3. **`rankProducts`** reads each product's index entry and marks it once per requirement,
   with a note. It is given the description and materials as well as the structured fields,
   so a mark of "the index does not say" reports Channel3's silence rather than ours. All
   24 rows are judged, not a top slice: a row nobody read would show an empty ledger and the
   counts on screen would stop adding up.
4. **PayPal Orders v2** sells a pass: one line item, priced by the server (the browser sends
   only where to come back to), with `PAY_NOW` so the shopper lands on payment rather than a
   review page. PayPal sends the shopper back with the order token, the app captures it, and
   only a `COMPLETED` capture becomes a pass. An order created and never captured charges
   nobody, so the round trip is the only part that proves the money moved. An errand that
   fails upstream is not charged for — the run is spent after the shortlist exists, not
   before — and **Payments v2 refunds** the unspent part of a pass on request, to the cent.
   Five errands a day are free from any address, so the thing can be tried without paying.
   What a pass buys is a wider search, not a bigger counter: a free errand reads one page of
   Channel3's index, a paid one pages through three, so about 70 products are judged against
   the sentence instead of 24. They are judged in batches of 24 rather than one long prompt,
   because a long prompt is where a model starts skipping rows — and a skipped row would show
   an empty ledger while still being counted. The shortlist says on screen which kind of
   errand produced it and how many pages it read.
5. **PayPal webhooks**, verified, close the hole the return URL leaves. Capture used to
   depend on the shopper's browser coming back from PayPal: a closed tab between "approve"
   and the redirect left the order `APPROVED` for ever — approved by the shopper, charged to
   nobody, with no pass. Now `CHECKOUT.ORDER.APPROVED` makes the server capture,
   `PAYMENT.CAPTURE.COMPLETED` grants the pass, and `PAYMENT.CAPTURE.REFUNDED` voids it,
   whatever the browser did. Every notification is checked with
   `/v1/notifications/verify-webhook-signature` against `PAYPAL_WEBHOOK_ID` first: an
   unverified body is a stranger's POST claiming somebody paid, so it is answered 400 and
   dropped, and with no webhook id configured the route accepts nothing at all. Each pass
   order also carries an `invoice_id`, a `custom_id` and the soft descriptor `ERRAND PASS`,
   so a payment can be reconciled from either side — and "Check with PayPal" on screen reads
   the order back from PayPal and shows the status, capture id and invoice number the PayPal
   dashboard shows for the same payment.

Every outbound call has a deadline (Channel3 25s, OpenAI 30s, PayPal 20s) and fails as a 504
with a reason. On a free hosting plan the common failure is not a wrong answer, it is a
request that hangs silently.

The model's spend is capped per process (`ERRAND_AI_SPEND_USD`, default `$3.00`). One errand
costs about **$0.033** at gpt-4.1 rates, so the cap is about 90 runs.

## Running it

Needs Node 22+ and pnpm.

```bash
pnpm install
cp .env.example .env     # fill in what you have; see below
pnpm build
node server/dist/index.js # serves the API and the built web app on :8787
```

For development, `pnpm dev` runs the API on `:8787` and Vite on `:5173`.

| Variable | What happens without it |
|---|---|
| `CHANNEL3_API_KEY` | Products come from bundled fixtures, labelled as fixtures |
| `OPENAI_API_KEY` | The plan is the raw sentence and nothing is judged |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | The Pay button reports that PayPal is not configured |
| `PAYPAL_SANDBOX` | Defaults to `true`. Sandbox credentials against live PayPal fail |
| `ERRAND_PUBLIC_URL` | PayPal sends the shopper back to `localhost:5173` |

`pnpm test` runs 33 tests with no keys set; `pnpm typecheck` covers both packages.

## What is deliberately missing

- **No order reaches the retailer, and none is meant to.** Errand sells searches, not goods:
  fulfilment would need a merchant relationship with each shop, Channel3 ships no checkout
  endpoint, and automating a checkout on a retailer's own site breaks that retailer's terms.
  The goods are bought by the shopper, at the shop, through the tracked link.
- **Passes live in memory too.** A restart loses how many runs a pass has spent, and the
  server re-reads the order from PayPal and hands the pass back whole — erring toward the
  person who paid. A real deployment would keep this in a database.
- **Results live in memory on the server.** The host sleeps when idle, so a restart clears
  them. Your own browser keeps a copy of the last ten shortlists, so a reload costs nothing
  and the sentences you have already run are listed under the box; a link shared with someone
  else answers 404 once the instance has restarted, and says why.
- **No login, no saved carts, no history.** One sentence, one screen.

## Built with

[Channel3](https://trychannel3.com) for product search · PayPal Orders v2 · OpenAI gpt-4.1 ·
[AG Grid Community](https://www.ag-grid.com/) (MIT) · React + Vite + TypeScript · deployed on
[Render](https://render.com).

MIT licensed.
