import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ColGroupDef,
  type GridApi,
  type GridReadyEvent,
  type IRowNode,
  type SelectionChangedEvent,
} from 'ag-grid-community';
import { baseColumns, defaultColDef, requirementColumns, MarkDot, money } from './grid';
import { createOrder, getErrand, getHealth, runErrand } from './api';
import type { CreatedOrder, Errand, Health, Row } from './types';
import { Detail } from './Detail';

ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * AG Grid is dressed to the screen's own rules rather than to its theme:
 * 12px grey sentence-case headers, no header band, no zebra, row rules three
 * steps off the surface, and the hue reserved for the agent's marks.
 */
const theme = themeQuartz.withParams({
  fontFamily: 'Geist, Inter, system-ui, sans-serif',
  backgroundColor: '#16181b',
  foregroundColor: '#ececee',
  headerBackgroundColor: '#16181b',
  headerTextColor: '#9ba0a7',
  headerFontSize: 12,
  headerFontWeight: 400,
  borderColor: '#212429',
  rowBorder: { style: 'solid', width: 1, color: '#212429' },
  oddRowBackgroundColor: '#16181b',
  rowHoverColor: '#1c1f23',
  selectedRowBackgroundColor: '#16233a',
  accentColor: '#5b9bf3',
  checkboxUncheckedBorderColor: '#4a4e55',
  inputBackgroundColor: '#16181b',
  inputBorder: { style: 'solid', width: 1, color: '#3c4046' },
  menuBackgroundColor: '#1c1f23',
  tooltipBackgroundColor: '#22252a',
  tooltipTextColor: '#ececee',
  cellHorizontalPadding: 16,
  wrapperBorder: false,
  headerColumnBorder: false,
  columnBorder: false,
  fontSize: 14,
  rowHeight: 72,
  headerHeight: 38,
});

const EXAMPLES = [
  'a gift for a six year old who loves dinosaurs, under $40, must be in stock',
  'a merino wool sweater for cold offices, size large, nothing over $120',
  'a desk lamp that will not glare on a second monitor, under $60',
];

/** Short labels; the sentence itself goes in the box, where it can be edited. */
const EXAMPLE_LABELS = ['A dinosaur gift under $40', 'A merino sweater for a cold office', 'A glare-free desk lamp'];

type Band = 'all' | 'clears' | 'short';

/** True while the viewport is at or under `px`, kept in step with resizes. */
function useNarrow(px: number): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(`(max-width: ${px}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [px]);
  return narrow;
}

export default function App() {
  // The desk-lamp sentence by default: it is the one the primer's worked
  // example takes apart, so the box and the figure say the same thing.
  const [sentence, setSentence] = useState(EXAMPLES[2]!);
  const [errand, setErrand] = useState<Errand>();
  const [health, setHealth] = useState<Health>();
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState(0);
  const [error, setError] = useState('');
  const [band, setBand] = useState<Band>('all');
  const [selected, setSelected] = useState<Row[]>([]);
  const [order, setOrder] = useState<CreatedOrder>();
  const [open, setOpen] = useState<Row>();
  const api = useRef<GridApi<Row>>(null);
  // Under about 980px the grid cannot hold the agent's sentence as well as the
  // ledger; it scrolled sideways and cut the prose mid-letter. The sentence
  // moves to the row's own sheet there, where it is read whole.
  const narrow = useNarrow(980);
  const box = useRef<HTMLTextAreaElement>(null);

  // The sentence box grows to whatever the sentence needs. A fixed height cut
  // the last line off on a phone, where the same sentence takes three lines.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [sentence, narrow]);

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

  /**
   * A ten-second wait with a dead button reads as a broken page. Counting the
   * seconds, and naming the sleeping instance once the wait passes what a warm
   * run takes, is the difference between waiting and giving up.
   */
  useEffect(() => {
    if (!busy) return setWaited(0);
    setWaited(0);
    const t = setInterval(() => setWaited((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const send = useCallback(async () => {
    setBusy(true);
    setError('');
    setOrder(undefined);
    setSelected([]);
    setBand('all');
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

  const rows = errand?.rows ?? [];
  const requirements = errand?.plan.requirements ?? [];

  /** Counts come from the rows on screen, so the cards and the grid agree. */
  const counts = useMemo(() => {
    const clears = rows.filter((r) => r.marks.length > 0 && r.marks.every((m) => m.holds === 'yes'));
    const short = rows.filter((r) => r.marks.some((m) => m.holds !== 'yes'));
    return { all: rows.length, clears: clears.length, short: short.length };
  }, [rows]);

  const isExternalFilterPresent = useCallback(() => band !== 'all', [band]);
  const doesExternalFilterPass = useCallback(
    (node: IRowNode<Row>) => {
      const r = node.data;
      if (!r) return true;
      if (band === 'clears') return r.marks.length > 0 && r.marks.every((m) => m.holds === 'yes');
      if (band === 'short') return r.marks.some((m) => m.holds !== 'yes');
      return true;
    },
    [band],
  );
  useEffect(() => {
    api.current?.onFilterChanged();
  }, [band]);

  const columns = useMemo<(ColDef<Row> | ColGroupDef<Row>)[]>(() => {
    const [product, ...rest] = baseColumns(narrow).filter((c) => !(narrow && c.field === 'why'));
    const reqs = requirementColumns(requirements, narrow);
    // The requirement columns are grouped under one line that names what they
    // are: the buyer's own words. Without it they read as three unrelated
    // columns of dots.
    const judged: ColGroupDef<Row>[] =
      reqs.length > 0
        ? [{ headerName: 'Judged against your words', marryChildren: true, children: reqs }]
        : [];
    // The requirement columns sit between the product and the agent's sentence,
    // so the ruling is read before the prose that explains it. Spreading the
    // rest keeps this honest when a base column is added or dropped: indexing
    // by hand left an undefined in the array and AG Grid threw on build.
    return [product!, ...judged, ...rest];
  }, [requirements, narrow]);

  const cart = useMemo(
    () => selected.filter((r) => r.inStock && r.price !== null).map((row) => ({ row, quantity: 1 })),
    [selected],
  );
  const cartTotal = useMemo(
    () => cart.reduce((sum, { row, quantity }) => sum + Math.round(row.price! * 100) * quantity, 0) / 100,
    [cart],
  );
  const unbuyable = selected.length - cart.length;

  const pay = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setOrder(await createOrder(cart));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [cart]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="wordmark">
            {/* A tick and a basket handle, drawn from what the agent does. */}
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M3 6h12l-1.3 8.2a1 1 0 0 1-1 .8H5.3a1 1 0 0 1-1-.8Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M6 6a3 3 0 0 1 6 0" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M6.6 10.3 8.3 12l3.4-3.4" fill="none" stroke="#5b9bf3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Errand
          </span>
          <span className="topbar-right">
            {health && (
              <>
                <span>
                  <span className="k">Products </span>
                  <b>{health.products === 'channel3-live' ? 'Channel3, live' : 'sample data'}</b>
                </span>
                <span>
                  <span className="k">PayPal </span>
                  <b>{health.paypal}</b>
                </span>
                <span className="num">
                  <span className="k">Model spend </span>
                  <b>${health.ai.spentUsd.toFixed(3)}</b> of ${health.ai.spendBudgetUsd.toFixed(2)}
                </span>
              </>
            )}
          </span>
        </div>
      </header>

      <main className="canvas">
        <div className="titlerow">
          <h1>{errand ? 'Your shortlist' : 'Say what you need'}</h1>
          <p className="finding">
            {errand ? (
              requirements.length > 0 ? (
                <>
                  <b>
                    {counts.clears} of {counts.all}
                  </b>{' '}
                  {requirements.length === 1
                    ? 'hold the one requirement the agent found in your sentence.'
                    : `hold all ${requirements.length} of your requirements.`}{' '}
                  The rest each miss something, and the ledger says which.
                </>
              ) : (
                <>
                  The agent found <b>{counts.all}</b> products but pulled no checkable requirement out
                  of that sentence, so there is nothing to rule on.
                </>
              )
            ) : (
              <>
                One sentence. The agent searches 25,000 retailers, judges every product against the
                requirements it finds in your words, and pays with PayPal once you approve.
              </>
            )}
          </p>
        </div>

        <section className="ask">
          <textarea
            ref={box}
            value={sentence}
            onChange={(e) => setSentence(e.target.value)}
            rows={1}
            placeholder="What do you need?"
            aria-label="What do you need?"
          />
          <button className="primary" onClick={send} disabled={busy || sentence.trim().length < 3}>
            {busy ? `Working… ${waited}s` : 'Send the agent'}
          </button>
        </section>
        <div className="examples">
          <span className="lead">Try</span>
          {EXAMPLES.map((e, i) => (
            <button key={e} className="chipbtn" onClick={() => setSentence(e)}>
              {EXAMPLE_LABELS[i]}
            </button>
          ))}
        </div>
        {busy && waited > 12 && (
          <p className="waking">
            Still going. This demo runs on a free instance that sleeps when idle, so the first search
            after a quiet spell spends most of its time waking up.
          </p>
        )}

        {error && (
          <div className="errorbox" role="alert" style={{ marginTop: 16 }}>
            <p>{error}</p>
            <button className="linkbtn" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}

        {busy && !errand && <Loading />}

        {!busy && !errand && <Primer />}

        {errand && (
          <section style={{ marginTop: 24 }}>
            {errand.origin === 'fixture' && <p className="notice">{errand.note}</p>}

            {/* The three counts are the screen's figures, so they are set as
                type rather than parked in tiles, and each one is the filter it
                describes (app-screens: KPIs as type, not cards). */}
            <div className="band">
              <div className="figures" role="group" aria-label="Filter the shortlist by ruling">
                {(
                  [
                    ['all', 'Found', counts.all],
                    ['clears', 'Hold everything', counts.clears],
                    ['short', 'Fall short', counts.short],
                  ] as const
                ).map(([key, label, value]) => (
                  <button
                    key={key}
                    className="figure"
                    aria-pressed={band === key}
                    onClick={() => setBand(key)}
                  >
                    <span className="value num">{value}</span>
                    <span className="label">{label}</span>
                  </button>
                ))}
              </div>
              <div className="bandtools">
                <input
                  placeholder="Filter the shortlist"
                  aria-label="Filter the shortlist"
                  onChange={(e) => api.current?.setGridOption('quickFilterText', e.target.value)}
                />
                <button
                  className="ghost"
                  onClick={() => api.current?.exportDataAsCsv({ fileName: 'errand.csv', allColumns: true })}
                >
                  Export what is shown
                </button>
              </div>
            </div>

            <div className="gridwrap">
              {requirements.length > 0 && (
                <div className="gridhead">
                  <p className="ledger-key">
                    <span>
                      <MarkDot holds="yes" /> holds
                    </span>
                    <span>
                      <MarkDot holds="unclear" /> the listing does not say
                    </span>
                    <span>
                      <MarkDot holds="no" /> fails
                    </span>
                  </p>
                  <span className="hint">
                    Hover a mark for what the listing said · double-click a row for the whole ledger
                  </span>
                </div>
              )}
              <div className="grid">
                <AgGridReact<Row>
                  theme={theme}
                  rowData={rows}
                  columnDefs={columns}
                  defaultColDef={defaultColDef}
                  getRowId={(p) => p.data.productId}
                  rowSelection={{ mode: 'multiRow', enableClickSelection: false }}
                  isExternalFilterPresent={isExternalFilterPresent}
                  doesExternalFilterPass={doesExternalFilterPass}
                  onGridReady={(e: GridReadyEvent<Row>) => {
                    api.current = e.api;
                  }}
                  onSelectionChanged={(e: SelectionChangedEvent<Row>) =>
                    setSelected(e.api.getSelectedRows())
                  }
                  onRowDoubleClicked={(e) => e.data && setOpen(e.data)}
                  tooltipShowDelay={200}
                  overlayNoRowsTemplate={'<span style="color:#6b6b6b">Nothing in this view.</span>'}
                />
              </div>
            </div>

            {order && (
              <div className="errorbox" style={{ marginTop: 12 }}>
                <p>
                  PayPal order <span className="num">{order.id}</span> · {order.status} ·{' '}
                  <span className="num">
                    {order.total} {order.currency}
                  </span>
                </p>
                {order.approveUrl && (
                  <a href={order.approveUrl} target="_blank" rel="noopener noreferrer">
                    Approve it in the PayPal sandbox
                  </a>
                )}
              </div>
            )}
          </section>
        )}
      </main>

      {errand && (
        <div className="cartbar">
          <div className="cartbar-inner">
            <span className="carttotal num">
              {cart.length === 0 ? '$0.00' : money(cartTotal, cart[0]!.row.currency)}
            </span>
            <span className="cartnote">
              {cart.length === 0
                ? 'Tick the rows you want.'
                : `${cart.length} item${cart.length > 1 ? 's' : ''} selected`}
              {unbuyable > 0 &&
                ` · ${unbuyable} selected row${unbuyable > 1 ? 's' : ''} cannot be bought`}
            </span>
            <button className="primary" onClick={pay} disabled={busy || cart.length === 0}>
              Pay with PayPal
            </button>
          </div>
        </div>
      )}

      {open && <Detail row={open} requirements={requirements} onClose={() => setOpen(undefined)} />}
    </>
  );
}

/** The final layout with each value a flat bar at its real size. */
/**
 * The first screen before anything has been asked. It says how the answer is
 * built and what the three marks mean, because that is the one thing a visitor
 * has to read before the grid makes sense. No sample products: an invented row
 * on a shopping agent is the one lie that would matter.
 */
function Primer() {
  return (
    <section className="primer">
      <ol className="steps">
        <li>
          <span className="n">1</span>
          <h3>Your sentence becomes requirements</h3>
          <p>
            The agent pulls the checkable parts out of your words: a price ceiling, a material, a
            use. Each one becomes a column, in your wording, not a shop&rsquo;s facet.
          </p>
        </li>
        <li>
          <span className="n">2</span>
          <h3>Every product found gets a mark per requirement</h3>
          <p>
            Products come from Channel3&rsquo;s live search across its retailer network. The agent
            reads each listing and rules on it, one requirement at a time.
          </p>
          <ul className="marks-key">
            <li>
              <MarkDot holds="yes" /> the listing says it holds
            </li>
            <li>
              <MarkDot holds="unclear" /> the listing does not say
            </li>
            <li>
              <MarkDot holds="no" /> the listing says it fails
            </li>
          </ul>
        </li>
        <li>
          <span className="n">3</span>
          <h3>You tick the rows and pay once</h3>
          <p>
            Nothing is bought until you approve it. The order goes to PayPal in sandbox mode, so
            this demo spends no real money, and the model&rsquo;s own spend is capped at $3.
          </p>
        </li>
      </ol>

      {/* The idea of the screen, shown once on the way in: the words you type
          are the columns everything is judged against. The fragments below are
          the two requirements the agent really pulls out of this sentence. */}
      <figure className="worked">
        <figcaption>What the first step looks like</figcaption>
        <p className="wsent">
          a desk lamp that <mark>will not glare on a second monitor</mark>,{' '}
          <mark>under $60</mark>
        </p>
        <div className="wcols">
          <span className="wcol">Product</span>
          <span className="wcol wreq">will not glare on a second monitor</span>
          <span className="wcol wreq">under $60</span>
          <span className="wcol">Price</span>
          <span className="wcol">Why the agent kept it</span>
        </div>
      </figure>
    </section>
  );
}

function Loading() {
  return (
    <div className="gridwrap" style={{ marginTop: 24 }} aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="skelrow" key={i}>
          <span className="skel" style={{ width: 48, height: 48, borderRadius: 2 }} />
          <span className="skel" style={{ width: 260, height: 14 }} />
          <span className="skel" style={{ width: 80, height: 14, marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}
