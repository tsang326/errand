import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  colorSchemeDark,
  type GridApi,
  type GridReadyEvent,
  type IRowNode,
  type SelectionChangedEvent,
} from 'ag-grid-community';
import { columns, defaultColDef, money } from './grid';
import { createOrder, getErrand, getHealth, runErrand } from './api';
import type { CreatedOrder, Errand, Health, Row } from './types';
import { Detail } from './Detail';

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withPart(colorSchemeDark);

const EXAMPLES = [
  'a gift for a six year old who loves dinosaurs, under $40, must be in stock',
  'a merino wool sweater for cold offices, size large, nothing over $120',
  'a desk lamp that will not glare on a second monitor, under $60',
];

type Band = 'all' | 'kept' | 'clean';

export default function App() {
  const [sentence, setSentence] = useState(EXAMPLES[0]!);
  const [errand, setErrand] = useState<Errand | undefined>();
  const [health, setHealth] = useState<Health | undefined>();
  const [busy, setBusy] = useState(false);
  /**
   * A ten-second wait with a dead button reads as a broken page. Counting the
   * seconds out loud — and naming the sleeping instance once the wait passes
   * what a warm run takes — is the difference between waiting and giving up.
   */
  const [waited, setWaited] = useState(0);
  const [error, setError] = useState('');
  const [quick, setQuick] = useState('');
  const [band, setBand] = useState<Band>('all');
  const [selected, setSelected] = useState<Row[]>([]);
  const [order, setOrder] = useState<CreatedOrder | undefined>();
  const [open, setOpen] = useState<Row | undefined>();
  const api = useRef<GridApi<Row> | undefined>(undefined);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(undefined));
    const id = window.location.hash.replace(/^#/, '');
    if (id) {
      getErrand(id)
        .then((e) => {
          setErrand(e);
          setSentence(e.sentence);
        })
        .catch((e: Error) => setError(e.message));
    }
  }, []);

  const send = useCallback(async () => {
    setBusy(true);
    setError('');
    setOrder(undefined);
    setSelected([]);
    try {
      const fresh = await runErrand(sentence);
      setErrand(fresh);
      window.location.hash = fresh.id;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      getHealth().then(setHealth).catch(() => undefined);
    }
  }, [sentence]);

  /**
   * The band filter runs through AG Grid's external filter rather than by
   * slicing the row array, so the grid's own count, sort and CSV export all
   * agree with what is on screen.
   */
  const isExternalFilterPresent = useCallback(() => band !== 'all', [band]);
  const doesExternalFilterPass = useCallback(
    (node: IRowNode<Row>) => {
      const r = node.data;
      if (!r) return true;
      if (band === 'kept') return (r.fit ?? 0) >= 70 && r.inStock;
      if (band === 'clean') return r.misses.length === 0 && r.inStock;
      return true;
    },
    [band],
  );

  useEffect(() => {
    if (!busy) return setWaited(0);
    setWaited(0);
    const t = setInterval(() => setWaited((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    api.current?.onFilterChanged();
  }, [band]);

  const onGridReady = (e: GridReadyEvent<Row>) => {
    api.current = e.api;
  };

  const onSelectionChanged = (e: SelectionChangedEvent<Row>) => {
    setSelected(e.api.getSelectedRows());
  };

  const cart = useMemo(
    () => selected.filter((r) => r.inStock && r.price !== null).map((row) => ({ row, quantity: 1 })),
    [selected],
  );
  const cartTotal = useMemo(
    () => cart.reduce((sum, { row, quantity }) => sum + Math.round((row.price ?? 0) * 100) * quantity, 0) / 100,
    [cart],
  );
  const unbuyable = selected.length - cart.length;

  const pay = async () => {
    setBusy(true);
    setError('');
    try {
      const created = await createOrder(cart);
      setOrder(created);
      if (created.approveUrl) window.open(created.approveUrl, '_blank', 'noopener');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header>
        <div>
          <h1>Errand</h1>
          <p className="tagline">
            Say what you need. The agent searches 25,000 retailers, shows you its reasoning, and pays
            with PayPal once you approve.
          </p>
        </div>
        {health && (
          <dl className="status">
            <div>
              <dt>products</dt>
              <dd className={health.products === 'channel3-live' ? 'ok' : 'warn'}>
                {health.products === 'channel3-live' ? 'Channel3 live' : 'offline fixtures'}
              </dd>
            </div>
            <div>
              <dt>paypal</dt>
              <dd>{health.paypal}</dd>
            </div>
            <div>
              <dt>model spend</dt>
              <dd>
                ${health.ai.spentUsd.toFixed(3)} / ${health.ai.spendBudgetUsd.toFixed(2)}
              </dd>
            </div>
          </dl>
        )}
      </header>

      <section className="ask">
        <textarea
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          rows={2}
          placeholder="What do you need?"
          aria-label="What do you need?"
        />
        <button className="primary" onClick={send} disabled={busy || sentence.trim().length < 3}>
          {busy ? `on it… ${waited}s` : 'Send the agent'}
        </button>
      </section>
      {busy && waited > 12 && (
        <p className="muted waking">
          Still going. This demo runs on a free instance that sleeps when idle, so the first
          search after a quiet spell spends most of its time waking up.
        </p>
      )}
      <div className="examples">
        {EXAMPLES.map((e) => (
          <button key={e} className="link" onClick={() => setSentence(e)}>
            {e}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      {errand && (
        <>
          <section className="plan">
            <div>
              <span className="label">searched for</span>
              <code>{errand.plan.query}</code>
            </div>
            {errand.plan.maxPrice !== undefined && (
              <div>
                <span className="label">ceiling</span>
                <code>${errand.plan.maxPrice}</code>
              </div>
            )}
            {errand.plan.requirements.length > 0 && (
              <div>
                <span className="label">must hold</span>
                <div className="chips">
                  {errand.plan.requirements.map((r) => (
                    <span className="chip" key={r}>
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="plan-meta">
              {errand.rows.length} products · plan by {errand.plan.source} · verdicts by{' '}
              {errand.ranking ? `${errand.ranking.source} · $${errand.ranking.costUsd.toFixed(4)}` : '—'}
            </div>
          </section>

          {errand.origin === 'fixture' && <p className="warn-banner">{errand.note}</p>}

          <section className="controls">
            <input
              value={quick}
              onChange={(e) => {
                setQuick(e.target.value);
                api.current?.setGridOption('quickFilterText', e.target.value);
              }}
              placeholder="filter every column"
              aria-label="filter every column"
            />
            <div className="bands">
              {(
                [
                  ['all', 'everything the search returned'],
                  ['kept', 'fit 70+ and buyable'],
                  ['clean', 'nothing missed and buyable'],
                ] as const
              ).map(([b, title]) => (
                <button
                  key={b}
                  title={title}
                  className={band === b ? 'band on' : 'band'}
                  onClick={() => setBand(b)}
                >
                  {b}
                </button>
              ))}
            </div>
            <button className="link" onClick={() => api.current?.exportDataAsCsv()}>
              export what is shown
            </button>
          </section>

          <div className="grid">
            <AgGridReact<Row>
              theme={theme}
              rowData={errand.rows}
              columnDefs={columns}
              defaultColDef={defaultColDef}
              getRowId={(p) => p.data.productId}
              rowSelection={{ mode: 'multiRow', enableClickSelection: false }}
              selectionColumnDef={{ width: 50, pinned: 'left' }}
              onGridReady={onGridReady}
              onSelectionChanged={onSelectionChanged}
              isExternalFilterPresent={isExternalFilterPresent}
              doesExternalFilterPass={doesExternalFilterPass}
              onRowClicked={(e) => setOpen(e.data)}
              tooltipShowDelay={200}
              domLayout="normal"
            />
          </div>

          <section className="cart">
            <div>
              <strong>{cart.length}</strong> to buy · {money(cartTotal, cart[0]?.row.currency ?? 'USD')}
              {unbuyable > 0 && (
                <span className="muted">
                  {' '}
                  · {unbuyable} selected row{unbuyable > 1 ? 's' : ''} cannot be bought
                </span>
              )}
            </div>
            <button className="primary" onClick={pay} disabled={busy || cart.length === 0}>
              Pay with PayPal
            </button>
          </section>

          {order && (
            <section className="order">
              <div>
                PayPal order <code>{order.id}</code> · {order.status} · {order.total} {order.currency}
              </div>
              {order.approveUrl && (
                <a href={order.approveUrl} target="_blank" rel="noopener noreferrer">
                  approve it in the PayPal sandbox
                </a>
              )}
            </section>
          )}
        </>
      )}

      {open && <Detail row={open} onClose={() => setOpen(undefined)} />}
    </div>
  );
}
