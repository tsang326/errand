# Errand

A shopping agent you can audit. You type one sentence; it searches real retailers, then
**rules on every product against every requirement it found in your words** and shows its
work as a ledger. You tick the rows you want and pay once, with PayPal.

**Live demo:** https://errand-46ur.onrender.com

> The demo runs PayPal in **sandbox**, so no real money moves. It also never places an order
> with the retailer: it creates a PayPal order for the rows you ticked. Prices and stock are
> the product index's snapshot, not the retailer's page at the moment you read it — each row
> links to the listing so you can check.

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
4. **PayPal Orders v2** gets the ticked rows as line items, summed in cents, with
   `PAY_NOW` so the shopper lands on payment rather than a review page.

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

- **No order reaches the retailer.** Errand creates the PayPal order; fulfilment would need a
  merchant relationship with each shop, which a demo cannot have.
- **Results live in memory.** The host sleeps when idle, so a restart clears them; a shared
  link to an old errand answers 404 and says why.
- **No login, no saved carts, no history.** One sentence, one screen.

## Built with

[Channel3](https://trychannel3.com) for product search · PayPal Orders v2 · OpenAI gpt-4.1 ·
[AG Grid Community](https://www.ag-grid.com/) (MIT) · React + Vite + TypeScript · deployed on
[Render](https://render.com).

MIT licensed.
