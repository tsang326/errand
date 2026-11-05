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
  type RowClassParams,
  type SelectionChangedEvent,
} from 'ag-grid-community';
import { baseColumns, defaultColDef, requirementColumns, tallyRow, MarkDot, money } from './grid';
import {
  buyPass,
  capturePass,
  getErrand,
  getHealth,
  passStatus,
  readPass,
  refundPass,
  runErrand,
} from './api';
import type { CapturedOrder, Errand, Health, Pass, PassStatus, Row } from './types';
import { Detail } from './Detail';
import { BuyPass } from './BuyPass';
import {
  forgetErrand,
  forgetHistory,
  listHistory,
  loadErrand,
  saveErrand,
  type HistoryEntry,
} from './history';

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
  // First, because it is the sentence that makes the ledger earn its keep: the
  // index carries both English and Japanese printings of the same card game, so
  // the second requirement rules a third of the rows out, by name, on evidence
  // a reader can check from the title. The other sentences mostly produce marks
  // the listings are silent about.
  //
  // Deliberately without a price ceiling. A ceiling in the sentence becomes a
  // hard Channel3 filter rather than a column, so the dearer half of the index
  // never reaches the screen and nothing on the screen says so: this query
  // capped at $120 hid every box up to the $281 the index really holds.
  'a sealed One Piece Card Game booster box, English edition, not a Japanese print',
  'a gift for a six year old who loves dinosaurs, under $40, must be in stock',
  'a merino wool sweater for cold offices, size large, nothing over $120',
  'a desk lamp that will not glare on a second monitor, under $60',
];

/** Short labels; the sentence itself goes in the box, where it can be edited. */
const EXAMPLE_LABELS = [
  'An English One Piece booster box',
  'A dinosaur gift under $40',
  'A merino sweater for a cold office',
  'A glare-free desk lamp',
];

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

/** Where this browser keeps the order id that proves it bought a pass. */
const PASS_KEY = 'errand.pass.v1';

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
  /**
   * The pass this browser holds, and the order id that proves it. The id is the
   * receipt: the server keeps passes in memory, so after a restart it asks
   * PayPal about this order and hands the pass back rather than leaving someone
   * who paid with nothing.
   */
  const [pass, setPass] = useState<Pass>();
  const [buying, setBuying] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [refunded, setRefunded] = useState<string>();
  /**
   * What PayPal says, as opposed to what this app says. Fetched only when
   * asked: it is one live call to PayPal, and its value is that the shopper
   * (or anyone reviewing it) can hold the capture id and invoice number on screen against
   * the same payment in the PayPal dashboard.
   */
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<PassStatus>();
  const [checkError, setCheckError] = useState<string>();
  /**
   * What PayPal says it took, once the shopper has come back from approving.
   * The app used to end at the approval link: it sent people to PayPal and
   * never asked what happened there, so nothing was ever actually charged and
   * no screen could tell an approved order from a paid one.
   */
  const [receipt, setReceipt] = useState<CapturedOrder>();
  const [cancelled, setCancelled] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [open, setOpen] = useState<Row>();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const freeRuns = health?.rate?.freeRunsPerDay ?? 5;
  const paidPages = health?.rate?.paidPages ?? 3;
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

    // Two ways in. Normally the errand id is the fragment, which keeps a
    // shortlist linkable. Coming back from PayPal it is the `e` query
    // parameter instead: PayPal appends its own token to the return URL and
    // drops the fragment, so the id has to travel where PayPal will keep it.
    const query = new URLSearchParams(window.location.search);
    const past = listHistory();
    setHistory(past);

    // No id anywhere means a plain reload or a fresh tab. Reopening the last
    // shortlist is what the shopper expected the page to still be showing, and
    // it costs nothing: re-running the same sentence spends a Channel3 search
    // and two model calls to arrive at the answer already in this browser.
    const id = window.location.hash.replace(/^#/, '') || (query.get('e') ?? '') || (past[0]?.id ?? '');
    if (id) {
      const mine = loadErrand(id);
      if (mine) {
        setErrand(mine);
        setSentence(mine.sentence);
        if (!window.location.hash) window.history.replaceState(null, '', `/#${id}`);
      } else {
        // Not this browser's: a shared link. The server may still hold it.
        getErrand(id)
          .then((e) => {
            setErrand(e);
            setSentence(e.sentence);
            saveErrand(e);
            setHistory(listHistory());
          })
          .catch((e: Error) => setError(e.message));
      }
    }

    // A pass outlives the page and the server's memory: the id is kept here, and
    // the server re-reads the order from PayPal when it has forgotten it.
    const held = localStorage.getItem(PASS_KEY);
    if (held) {
      void readPass(held).then((p) => {
        if (p && !p.refundedAt) setPass(p);
        else localStorage.removeItem(PASS_KEY);
      });
    }

    const path = window.location.pathname;
    // Put the app back on its own URL before anything else: the token must not
    // survive a reload, and the shortlist is addressed by fragment everywhere
    // else in this app.
    const settle = () => window.history.replaceState(null, '', id ? `/#${id}` : '/');

    if (path === '/cancelled') {
      setCancelled(true);
      settle();
      return;
    }

    // PayPal names the order `token` on the way back. No token means somebody
    // typed the path, and there is nothing to take money for.
    const token = query.get('token');
    if (path !== '/paid' || !token) return;

    setCapturing(true);
    capturePass(token)
      .then(({ captured, pass: bought }) => {
        setPass(bought);
        localStorage.setItem(PASS_KEY, bought.orderId);
        if (captured) setReceipt(captured);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setCapturing(false);
        settle();
      });
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
    setBand('all');
    try {
      const fresh = await runErrand(sentence, pass && pass.left > 0 ? pass.orderId : undefined);
      if (fresh.pass) setPass(fresh.pass);
      setErrand(fresh);
      saveErrand(fresh);
      setHistory(listHistory());
      window.location.hash = fresh.id;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      getHealth().then(setHealth).catch(() => undefined);
    }
    // `pass` belongs in here: it arrives after the first render (restored from
    // storage, or bought in another tab), and a callback that still closed over
    // the old value sent a paid shopper's errand as a free one.
  }, [sentence, pass]);

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

  /**
   * The pinned tally row, rebuilt on AG Grid's modelUpdated from whatever rows
   * survive every filter: the figure band, the quick filter and the column
   * filters all feed it, so the tally and the rows under it never disagree.
   * (filterChanged is too early: it fires before the row model has refiltered.)
   */
  const [tally, setTally] = useState<Row[]>([]);
  const retally = useCallback(() => {
    const g = api.current;
    if (!g || requirements.length === 0) return setTally([]);
    const inView: Row[] = [];
    g.forEachNodeAfterFilter((n) => {
      if (n.data) inView.push(n.data);
    });
    const next = tallyRow(inView, requirements.length);
    // modelUpdated fires on sorts as well; a sort does not change the tally,
    // and a fresh object each time would re-render the pinned row for nothing.
    setTally((prev) =>
      prev[0] && JSON.stringify(prev[0].tally) === JSON.stringify(next.tally) &&
      JSON.stringify(prev[0].tallyOf) === JSON.stringify(next.tallyOf)
        ? prev
        : [next],
    );
  }, [requirements.length]);
  useEffect(() => {
    retally();
  }, [rows, retally]);

  const rowClass = useCallback(
    (p: RowClassParams<Row>) =>
      p.node.rowPinned
        ? 'tallyrow'
        : p.data && p.data.marks.length > 0 && p.data.marks.every((m) => m.holds === 'yes')
          ? 'clearsrow'
          : undefined,
    [],
  );

  const columns = useMemo<(ColDef<Row> | ColGroupDef<Row>)[]>(() => {
    const [product, ...rest] = baseColumns(narrow, counts.clears > 0).filter(
      (c) => !(narrow && c.field === 'why'),
    );
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
    // counts.clears is a dependency, not decoration: the last column renames
    // itself when a run holds nothing, and a stale memo would keep the old name.
  }, [requirements, narrow, counts.clears]);


  /**
   * Reopens a shortlist this browser already has. No network, no credit: the
   * whole point of keeping it.
   */
  const reopen = useCallback((id: string) => {
    const e = loadErrand(id);
    if (!e) return;
    setErrand(e);
    setSentence(e.sentence);
    setBand('all');
    setError('');
    window.location.hash = id;
  }, []);

  /** The bill stands between Pay and PayPal; nothing is created until Confirm. */
  /** The pass dialog stands between the button and PayPal; nothing is created until Confirm. */
  const [offering, setOffering] = useState(false);

  const buy = useCallback(async () => {
    setBuying(true);
    setError('');
    try {
      const created = await buyPass();
      if (created.approveUrl) {
        // Same tab: the return URL brings the shopper back here to be captured.
        window.location.assign(created.approveUrl);
        return;
      }
      setError(`PayPal created order ${created.id} with no approval link (${created.status}).`);
      setOffering(false);
    } catch (e) {
      setError((e as Error).message);
      setOffering(false);
    } finally {
      setBuying(false);
    }
  }, []);

  /** Hands back the errands the shopper never used. */
  const check = useCallback(async (orderId: string) => {
    setChecking(true);
    setCheckError(undefined);
    try {
      setChecked(await passStatus(orderId));
    } catch (err) {
      setCheckError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }, []);

  const giveBack = useCallback(async () => {
    if (!pass) return;
    setRefunding(true);
    setError('');
    try {
      const { refund, pass: after } = await refundPass(pass.orderId);
      setPass({ ...after, refundedAt: new Date().toISOString() });
      setRefunded(`${refund.amount ?? ''} ${refund.currency ?? ''}`.trim());
      localStorage.removeItem(PASS_KEY);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefunding(false);
    }
  }, [pass]);

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
                  <b>${health.ai.spentUsd.toFixed(3)}</b>
                  <span className="k since">
                    {' '}of ${health.ai.spendBudgetUsd.toFixed(2)} today (UTC)
                  </span>
                </span>
              </>
            )}
          </span>
        </div>
      </header>

      <main className="canvas">
        {/* The end of the errand, and the only screen that can honestly say
            money moved. It sits above everything because a shopper coming back
            from PayPal is asking one question, and the shortlist is not the
            answer to it. */}
        {capturing && (
          <div className="receipt receipt-wait">
            <p>Asking PayPal what it took&hellip;</p>
          </div>
        )}
        {receipt && (
          <div className="receipt">
            <p className="rhead">
              {receipt.status === 'COMPLETED'
                ? `Paid. Your pass is good for ${pass?.left ?? ''} errands.`
                : `PayPal returned ${receipt.status}.`}
            </p>
            <dl className="rgrid">
              {receipt.amount && (
                <div>
                  <dt>Amount</dt>
                  <dd className="num">
                    {receipt.amount} {receipt.currency ?? ''}
                  </dd>
                </div>
              )}
              {receipt.captureId && (
                <div>
                  {/* The capture id, not the order id: the order is the
                      intent, the capture is the money. Printed so it can be
                      looked up in the PayPal dashboard. */}
                  <dt>Capture</dt>
                  <dd className="num">{receipt.captureId}</dd>
                </div>
              )}
              <div>
                <dt>Order</dt>
                <dd className="num">{receipt.id}</dd>
              </div>
              {receipt.payer && (
                <div>
                  <dt>Paid by</dt>
                  <dd>{receipt.payer}</dd>
                </div>
              )}
            </dl>
            <p className="rnote">
              This paid for the agent&rsquo;s work, not for goods: the products are bought at the
              retailer, and the retailer name in every row is the link there. PayPal sandbox, so no
              real money moved. The errands you do not spend can be refunded from the bar below.
            </p>
          </div>
        )}
        {cancelled && !receipt && (
          <div className="receipt receipt-off">
            <p className="rhead">You cancelled at PayPal. Nothing was charged.</p>
            <p className="rnote">No pass was bought. The free errands still work.</p>
          </div>
        )}
        <div className="titlerow">
          <h1>
            {errand
              ? counts.clears === 0
                ? 'What the ledger found'
                : 'Your shortlist'
              : 'Say what you need'}
          </h1>
          <p className="finding">
            {errand ? (
              requirements.length > 0 ? (
                <>
                  <b>
                    {counts.clears} of {counts.all}
                  </b>{' '}
                  {requirements.length === 1
                    ? 'hold the one requirement the agent found in your sentence.'
                    : requirements.length === 2
                      ? 'hold both of your requirements.'
                      : `hold all ${requirements.length} of your requirements.`}{' '}
                  {/* The old line promised "the rest each miss something", which is
                      false whenever every mark is silence rather than a failure, and
                      reads as a tombstone when nothing clears. Say what the marks
                      actually are instead. */}
                  {counts.clears === 0
                    ? 'Nothing here clears your sentence. The ledger says, mark by mark, what each listing answered and what it left out.'
                    : 'The ledger says, mark by mark, what each of the rest answered and what it left out.'}
                </>
              ) : (
                <>
                  The agent found <b>{counts.all}</b> products but pulled no checkable requirement out
                  of that sentence, so there is nothing to rule on.
                </>
              )
            ) : (
              <>
                One sentence. The agent searches Channel3&rsquo;s retailer index, judges every
                product against the requirements it finds in your words, and pays with PayPal once
                you approve.
              </>
            )}
          </p>
          {/* What the pass bought, on the page that it bought it for. A paid
              errand reads several pages of the index, so the shopper can see
              the width they paid for rather than take it on trust. */}
          {errand && errand.pagesRead !== undefined && (
            <p className="depth">
              {errand.deep
                ? `Paid errand \u00b7 ${errand.pagesRead} pages of Channel3\u2019s index read, ${counts.all} products judged.`
                : `Free errand \u00b7 one page of the index, ${counts.all} products judged. A pass reads more on each run.`}
            </p>
          )}
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
        {history.length > 0 && (
          <div className="examples recent">
            {/* The server forgets an errand when the free instance sleeps or a
                deploy replaces it, so this list is the only thing standing
                between a reload and paying for the same search twice. */}
            <span className="lead">Already searched</span>
            {history.map((h) => (
              /* Two buttons in one chip rather than a button inside a button:
                 reopening and forgetting are different acts and the second one
                 is not undoable, so it gets its own target and its own label. */
              <span key={h.id} className={`chipwrap${errand?.id === h.id ? ' on' : ''}`}>
                <button
                  className="chipbtn"
                  onClick={() => reopen(h.id)}
                  title={`${h.sentence}\n${h.clears} of ${h.rows} held everything · ${new Date(h.at).toLocaleString()}`}
                >
                  {h.sentence.length > 42 ? `${h.sentence.slice(0, 42)}\u2026` : h.sentence}
                  <span className="chipcount">
                    {h.clears}/{h.rows}
                  </span>
                </button>
                <button
                  className="chipx"
                  aria-label={`Forget: ${h.sentence}`}
                  title="Forget this one"
                  onClick={() => {
                    forgetErrand(h.id);
                    setHistory(listHistory());
                    // Forgetting the shortlist on screen does not close it: the
                    // shopper asked to stop keeping it, not to lose it now.
                  }}
                >
                  <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                    <path
                      d="M3.2 3.2 8.8 8.8M8.8 3.2 3.2 8.8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </span>
            ))}
            <button
              className="chipbtn chipforget"
              onClick={() => {
                forgetHistory();
                setHistory([]);
              }}
              title="Remove every saved shortlist from this browser"
            >
              Forget these
            </button>
          </div>
        )}
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
                  onClick={() => api.current?.exportDataAsCsv({ fileName: 'errand.csv', allColumns: true, skipPinnedTop: true })}
                >
                  Export what is shown
                </button>
              </div>
            </div>

            <p className="plan">
              <span className="k">Searched</span> <span className="q">{errand.plan.query}</span>
              {errand.plan.maxPrice !== undefined && (
                <>
                  {' · '}
                  <b>under {money(errand.plan.maxPrice, errand.rows[0]?.currency ?? 'USD')}</b>, as a
                  filter, not a column
                </>
              )}
              {' · '}
              {requirements.length === 0
                ? 'no checkable requirement found'
                : `${requirements.length} requirement${requirements.length === 1 ? '' : 's'}, one per column`}
            </p>

            <div className="gridwrap">
              {requirements.length > 0 && (
                <div className="gridhead">
                  <p className="ledger-key">
                    <span>
                      <MarkDot holds="yes" /> holds
                    </span>
                    <span>
                      <MarkDot holds="unclear" /> the index does not say
                    </span>
                    <span>
                      <MarkDot holds="no" /> fails
                    </span>
                  </p>
                  <span className="hint">
                    Hover a mark for what the index entry said · double-click a row for the whole ledger
                  </span>
                  <span className="asof">
                    {/* Checked against a retailer page on 2026-11-04: the index had a
                        One Piece booster box at $120 while StockX asked $219 for it,
                        $120 being the box&rsquo;s printed retail. The caveat has to say
                        which number this is, not just that it may be stale. */}
                    Price and stock come from the product index, not the retailer&rsquo;s
                    page right now, and on resale listings the index can carry the
                    printed retail price rather than today&rsquo;s ask. Open a listing
                    before you buy.
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
                  isExternalFilterPresent={isExternalFilterPresent}
                  doesExternalFilterPass={doesExternalFilterPass}
                  pinnedTopRowData={tally}
                  getRowHeight={(p) => (p.node.rowPinned ? 54 : undefined)}
                  getRowClass={rowClass}
                  onGridReady={(e: GridReadyEvent<Row>) => {
                    api.current = e.api;
                    retally();
                  }}
                  onModelUpdated={retally}
                  onRowDoubleClicked={(e) => !e.node.rowPinned && e.data && setOpen(e.data)}
                  tooltipShowDelay={200}
                  overlayNoRowsTemplate={'<span style="color:#6b6b6b">Nothing in this view.</span>'}
                />
              </div>
            </div>
          </section>
        )}
      </main>

      {/* The bar at the foot used to total a cart of goods and offer to pay for
          them, which is money Errand cannot earn: the retailer sells the
          products. It carries the pass instead — what is left of the work the
          shopper has paid for, and the one place to buy more. */}
      <div className="passbar">
        <div className="passbar-inner">
          {pass && !pass.refundedAt ? (
            <>
              <span className="passleft num">{pass.left}</span>
              <span className="cartnote">
                errand{pass.left === 1 ? '' : 's'} left on your pass &middot; {pass.used} of{' '}
                {pass.runs} used &middot; paid ${pass.amount} {pass.currency}
              </span>
              <button
                className="ghost"
                onClick={() => void check(pass.orderId)}
                disabled={checking}
                title="Reads this payment back from PayPal"
              >
                {checking ? 'Asking PayPal…' : 'Check with PayPal'}
              </button>
              {pass.left > 0 && (
                <button className="ghost" onClick={() => void giveBack()} disabled={refunding}>
                  {refunding ? 'Refunding…' : 'Refund what is left'}
                </button>
              )}
              <button className="primary" onClick={() => setOffering(true)} disabled={buying}>
                Another pass
              </button>
            </>
          ) : (
            <>
              <span className="cartnote">
                {refunded
                  ? `Refunded ${refunded}. The free errands still work.`
                  : `${freeRuns} free errands a day on this device. A pass covers ${health?.pass?.runs ?? 15} more, each reading ${paidPages}\u00d7 as much of the index.`}
              </span>
              <button className="primary" onClick={() => setOffering(true)} disabled={buying}>
                Buy a pass &middot; ${health?.pass?.price ?? '3.00'}
              </button>
            </>
          )}
        </div>
        {(checked || checkError) && (
          <div className="paypalsays">
            {checkError ? (
              <span className="says-bad">PayPal would not answer: {checkError}</span>
            ) : (
              <>
                <span className="says-tag">PayPal says</span>
                <span className="num">{checked!.paypal.status}</span>
                {checked!.paypal.amount && (
                  <span>
                    {' '}
                    &middot; {checked!.paypal.amount} {checked!.paypal.currency ?? ''}
                  </span>
                )}
                {checked!.paypal.captureId && (
                  <span>
                    {' '}
                    &middot; capture <span className="num">{checked!.paypal.captureId}</span>
                    {checked!.paypal.captureStatus ? ` (${checked!.paypal.captureStatus})` : ''}
                  </span>
                )}
                {checked!.paypal.invoiceId && (
                  <span>
                    {' '}
                    &middot; invoice <span className="num">{checked!.paypal.invoiceId}</span>
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {offering && (
        <BuyPass
          {...(health ? { health } : {})}
          busy={buying}
          onConfirm={() => void buy()}
          onClose={() => setOffering(false)}
        />
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
            {/* "The agent reads each listing" was not true and was the screen&rsquo;s
              strongest claim: the agent never opens a retailer page. It reads what
              Channel3 holds about the product. Saying which fields is what lets a
              reader decide whether a silence is the retailer&rsquo;s or ours. */}
            Products come from Channel3&rsquo;s live search across its retailer network. The agent
            never opens a retailer&rsquo;s page: it reads that product&rsquo;s entry in the
            index &mdash; title, description, materials, attributes, key features, variants
            and the cheapest offer &mdash; and rules on it, one requirement at a time.
          </p>
          <ul className="marks-key">
            <li>
              <MarkDot holds="yes" /> the index entry says it holds
            </li>
            <li>
              <MarkDot holds="unclear" /> the index entry does not say
            </li>
            <li>
              <MarkDot holds="no" /> the index entry says it fails
            </li>
          </ul>
        </li>
        <li>
          <span className="n">3</span>
          <h3>You buy at the shop; you pay Errand for the search</h3>
          <p>
            Every retailer name in the shortlist is the link to buy there. PayPal pays for the
            agent&rsquo;s work instead &mdash; a pass of errands, refundable for the part you do not
            spend. The agent never buys on a shop&rsquo;s site for you.
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
