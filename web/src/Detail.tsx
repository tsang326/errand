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
        <header className="sheet-top">
          {row.imageUrl ? (
            <img className="sheet-shot" src={row.imageUrl} alt="" />
          ) : (
            <span className="sheet-shot noimg" aria-hidden="true" />
          )}
          <div className="sheet-id">
            <h3>{row.title}</h3>
            <p className="cartnote">
              {row.brand ? `${row.brand} · ` : ''}
              {row.retailer || 'no retailer listed'}
            </p>
            <p className="sheet-price num">
              {row.price === null ? '—' : money(row.price, row.currency)}
              {row.compareAtPrice !== null && row.compareAtPrice > (row.price ?? 0) && (
                <span className="was">{money(row.compareAtPrice, row.currency)}</span>
              )}
            </p>
            {/* Next to the price, which is what it is about, rather than up in
                the corner competing with Close for the title's width. */}
            {row.url && (
              <a className="ghost sheet-open" href={row.url} target="_blank" rel="noreferrer noopener">
                Open the listing
              </a>
            )}
          </div>
          <button className="ghost sheet-close" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>

        {row.why && <p className="sheet-why">{row.why}</p>}

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
