import { useEffect } from 'react';
import type { Health } from './types';

/**
 * What a pass is, before buying one.
 *
 * This screen replaced a bill for a cart of products, which was the wrong
 * thing to charge for: Channel3 has no checkout, the retailer sells the goods,
 * and Errand neither holds them nor ships them. The search is what Errand
 * makes, so the search is what it sells. Everything here is a fact about that:
 * the price, how many errands it covers, what one costs to serve, and that the
 * unused part comes back on request.
 */
export function BuyPass({
  health,
  busy,
  onConfirm,
  onClose,
}: {
  health?: Health;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const runs = health?.pass?.runs ?? 25;
  const price = health?.pass?.price ?? '3.00';
  const currency = health?.pass?.currency ?? 'USD';

  return (
    <div className="bill-back" onClick={() => !busy && onClose()} role="presentation">
      <section
        className="bill"
        role="dialog"
        aria-modal="true"
        aria-label="Buy a pass"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bill-top">
          <h3>A pass for {runs} errands</h3>
          <p className="cartnote">You are paying for the agent&rsquo;s work, not for goods.</p>
        </header>

        <ul className="bill-lines">
          <li>
            <span className="bl-title">
              {runs} errands
              <span className="bl-sub">
                One errand is a Channel3 search and two model calls &middot; about $0.04 to serve
              </span>
            </span>
            <span className="bl-price num">
              ${price} {currency}
            </span>
          </li>
        </ul>

        <div className="bill-total">
          <span>Total</span>
          <span className="num">
            ${price} {currency}
          </span>
        </div>

        <p className="bill-note">
          The products themselves are bought at the retailer &mdash; every retailer name in the
          shortlist is the link, and Errand earns a commission there if you buy. The agent never
          buys on a shop&rsquo;s site for you, which is a choice, not a missing feature.
        </p>
        <p className="bill-note">
          A run that fails is not charged for, and the errands you have not spent can be refunded
          to the same PayPal account whenever you ask. Sandbox mode, so no real money moves.
        </p>

        <div className="bill-acts">
          <button className="ghost" onClick={onClose} disabled={busy}>
            Not now
          </button>
          <button className="primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Creating the order…' : `Pay $${price} at PayPal`}
          </button>
        </div>
      </section>
    </div>
  );
}
