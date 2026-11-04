import { useEffect } from 'react';
import { money } from './grid';
import type { PriceCheck, Row } from './types';

/**
 * The bill, before anyone leaves for PayPal.
 *
 * Pay used to go straight to PayPal's approval page from a button that sat in
 * a bar showing one figure. The shopper's last look at what they were actually
 * buying was the grid behind it, and the agent chose those rows, not them. A
 * payment is the one step in this app that cannot be undone from this app, so
 * it gets a page of its own: every line, its retailer, the figure it was
 * indexed at, the total PayPal will be asked for, and the warnings that are
 * easy to scroll past in the cart bar.
 *
 * It asks for nothing and spends nothing: the order is only created once
 * Confirm is pressed, so backing out here costs a PayPal call that never
 * happened.
 */
export function Confirm({
  cart,
  total,
  stale,
  unbuyable,
  busy,
  onQuantity,
  onConfirm,
  onClose,
}: {
  cart: { row: Row; quantity: number }[];
  total: number;
  stale: PriceCheck[];
  unbuyable: number;
  busy: boolean;
  onQuantity: (productId: string, n: number) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    // Escape backs out, except while the order is being created: there is a
    // PayPal call in flight by then and closing the bill would hide it.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const currency = cart[0]?.row.currency ?? 'USD';

  return (
    <div className="bill-back" onClick={() => !busy && onClose()} role="presentation">
      <section
        className="bill"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm what you are paying for"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bill-top">
          <h3>What PayPal will be asked for</h3>
          <p className="cartnote">
            {cart.length} item{cart.length > 1 ? 's' : ''} from your shortlist.
          </p>
        </header>

        <ul className="bill-lines">
          {cart.map(({ row, quantity }) => (
            <li key={row.productId}>
              <span className="bl-title">
                {row.title}
                <span className="bl-sub">
                  {row.retailer || 'no retailer listed'} &middot;{' '}
                  {money(row.price!, row.currency)} each
                </span>
              </span>
              {/* The quantity lives here and nowhere else: this is the screen
                  where the shopper is deciding what to pay for, and the grid is
                  the agent's ruling, not a basket. */}
              <span className="bl-qty">
                <button
                  className="qbtn"
                  onClick={() => onQuantity(row.productId, quantity - 1)}
                  disabled={busy || quantity <= 1}
                  aria-label={`One fewer: ${row.title}`}
                >
                  &minus;
                </button>
                <input
                  className="qnum num"
                  type="number"
                  min={1}
                  max={20}
                  value={quantity}
                  disabled={busy}
                  aria-label={`Quantity: ${row.title}`}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(n)) onQuantity(row.productId, n);
                  }}
                />
                <button
                  className="qbtn"
                  onClick={() => onQuantity(row.productId, quantity + 1)}
                  disabled={busy || quantity >= 20}
                  aria-label={`One more: ${row.title}`}
                >
                  +
                </button>
              </span>
              <span className="bl-price num">
                {money(row.price! * quantity, row.currency)}
              </span>
            </li>
          ))}
        </ul>

        <div className="bill-total">
          <span>Total</span>
          <span className="num">{money(total, currency)}</span>
        </div>

        {stale.length > 0 && (
          <p className="bill-warn">
            {stale.length === 1 ? 'One line is' : `${stale.length} lines are`} priced at a figure
            Channel3&rsquo;s own price history has moved on from. The total above is what the
            shortlist showed; open the listing before you approve.
          </p>
        )}
        {unbuyable > 0 && (
          <p className="bill-warn">
            {unbuyable} ticked row{unbuyable > 1 ? 's are' : ' is'} out of stock in the index and
            {unbuyable > 1 ? ' are' : ' is'} not on this bill.
          </p>
        )}

        <p className="bill-note">
          The index says these are in stock; it does not say how many, so the ceiling on a line is
          twenty. Confirming creates the PayPal order and sends you to PayPal to approve it. Sandbox mode,
          so no real money moves, and nothing is ordered from the retailer &mdash; the agent does
          not buy on a shop&rsquo;s site for you.
        </p>

        <div className="bill-acts">
          <button className="ghost" onClick={onClose} disabled={busy}>
            Back to the shortlist
          </button>
          <button className="primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Creating the order…' : 'Confirm and approve at PayPal'}
          </button>
        </div>
      </section>
    </div>
  );
}
