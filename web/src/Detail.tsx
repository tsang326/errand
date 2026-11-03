import type { Row } from './types';

/**
 * What the agent judged the row on. A verdict is only worth reading next to the
 * evidence behind it, and the evidence here is Channel3's own extracted
 * attributes, not prose the model wrote.
 */
export function Detail({ row, onClose }: { row: Row; onClose: () => void }) {
  const attrs = Object.entries(row.attributes);
  return (
    <aside className="detail" role="dialog" aria-label={row.title}>
      <header>
        <h2>{row.title}</h2>
        <button className="link" onClick={onClose} aria-label="close">
          close
        </button>
      </header>

      <p className="detail-why">
        {row.fit === null ? 'The agent did not judge this row.' : row.why}
      </p>

      {row.misses.length > 0 && (
        <div className="chips">
          {row.misses.map((m) => (
            <span className="chip chip-bad" key={m}>
              {m}
            </span>
          ))}
        </div>
      )}

      {row.categoryPath.length > 0 && (
        <p className="detail-path">{row.categoryPath.join(' › ')}</p>
      )}

      {attrs.length > 0 && (
        <>
          <h3>What the retailer states</h3>
          <dl className="attrs">
            {attrs.map(([k, v]) => (
              <div key={k}>
                <dt>{k.replace(/-/g, ' ')}</dt>
                <dd>{v.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {row.keyFeatures.length > 0 && (
        <>
          <h3>Listed features</h3>
          <ul className="features">
            {row.keyFeatures.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      )}

      <p className="detail-foot">
        {row.offerCount} retailer{row.offerCount === 1 ? '' : 's'} carry this
        {row.commissionRate > 0 && ` · best commission ${(row.commissionRate * 100).toFixed(1)}%`}
      </p>
    </aside>
  );
}
