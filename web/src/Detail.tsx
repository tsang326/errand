import { useEffect } from 'react';
import { MarkDot, money } from './grid';
import type { Row } from './types';

const WORD = { yes: 'Holds', no: 'Fails', unclear: 'Not stated' } as const;

/**
 * One product, with the agent's ruling on each requirement written out. The
 * grid shows the marks; this shows what the listing actually said, which is
 * the only way to disagree with the agent.
 */
export function Detail({
  row,
  requirements,
  onClose,
}: {
  row: Row;
  requirements: readonly string[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-back" onClick={onClose} role="presentation">
      <aside
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={row.title}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="ghost" onClick={onClose} style={{ float: 'right' }}>
          Close
        </button>
        <h3>{row.title}</h3>
        <p className="cartnote" style={{ margin: 0 }}>
          {row.brand ? `${row.brand} · ` : ''}
          {row.retailer || 'no retailer listed'}
        </p>

        {row.why && <p style={{ marginTop: 14 }}>{row.why}</p>}

        {requirements.length > 0 && (
          <ul className="marklist">
            {requirements.map((text, i) => {
              const m = row.marks[i];
              return (
                <li key={text}>
                  <MarkDot holds={m?.holds ?? 'unclear'} />
                  <span>
                    <span className="req">{text}</span>
                    <span className="note">
                      {WORD[m?.holds ?? 'unclear']}
                      {m?.note ? `: ${m.note}` : ''}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <dl>
          <div className="kv">
            <dt>Price</dt>
            <dd className="num" style={{ margin: 0 }}>
              {row.price === null ? '—' : money(row.price, row.currency)}
            </dd>
          </div>
          <div className="kv">
            <dt>Offers</dt>
            <dd className="num" style={{ margin: 0 }}>
              {row.offerCount}
            </dd>
          </div>
          <div className="kv">
            <dt>Stock</dt>
            <dd style={{ margin: 0 }}>{row.inStock ? 'In stock' : 'Cannot be bought'}</dd>
          </div>
          <div className="kv">
            <dt>Category</dt>
            <dd style={{ margin: 0 }}>{row.categoryPath.join(' › ') || row.category || '—'}</dd>
          </div>
        </dl>

        {row.keyFeatures.length > 0 && (
          <>
            <h4 style={{ fontSize: 14, fontWeight: 500, margin: '16px 0 6px' }}>
              What the listing says
            </h4>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)' }}>
              {row.keyFeatures.slice(0, 6).map((f) => (
                <li key={f} style={{ marginBottom: 4 }}>
                  {f}
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}
