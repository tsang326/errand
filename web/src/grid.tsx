import type { ColDef, ICellRendererParams, ValueGetterParams } from 'ag-grid-community';
import type { Mark, Row } from './types';

/** Money arrives in whole currency units; one formatter, used everywhere. */
export const money = (value: number, currency: string): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

/**
 * The three marks are shapes first and colour second, so the ledger still
 * reads when the colour does not: filled holds, hollow is silence, barred
 * fails. The one hue on the screen sits here, on the agent's ruling, which is
 * what the screen exists to show.
 */
export function MarkDot({ holds }: { holds: Mark['holds'] }) {
  return <span className={`mk mk-${holds}`} />;
}

const MARK_WORD: Record<Mark['holds'], string> = {
  yes: 'holds',
  no: 'fails',
  // Not "the listing": the agent never reads the retailer's page, only the
  // index's entry for the product. The distinction decides whose silence this
  // mark is reporting, which is the whole weight the mark carries.
  unclear: 'the index does not say',
};

function ProductCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  return (
    <div className="product">
      {data.imageUrl ? (
        <img src={data.imageUrl} alt="" loading="lazy" />
      ) : (
        <span className="noimg" aria-hidden="true" />
      )}
      <span className="ptitle">
        <span className="t">{data.title}</span>
        <span className="b">
          {/* No brand here. The index put "Uno" and "Mattiel" on Bandai's One
              Piece booster boxes, and the cell stated it as the product's maker
              beside a title that said otherwise. It is index metadata, not an
              identity, so it moved into the row's sheet where it is labelled as
              such. The title and the retailer link are what a reader can check. */}
          {/* The retailer's name is the link to the listing: the shortlist
              claims these are real products, and this is how that is checked.
              The click must not reach the row, which would select it. */}
          {data.url ? (
            <a
              className="shoplink"
              href={data.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              title={`Open this listing on ${data.retailer}`}
            >
              {data.retailer}
            </a>
          ) : (
            data.retailer || 'no retailer listed'
          )}
          {/* "cannot be bought" asserted a fact about the retailer right now.
              The app only knows what the index last recorded. */}
          {!data.inStock && <span className="pill pill-out">out of stock in the index</span>}
        </span>
      </span>
    </div>
  );
}

function PriceCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  // A missing price is a grey dash; a real price is never dressed up.
  if (data.price === null) return <span className="dash">—</span>;
  // No struck-through "was" price. Channel3's compareAtPrice is not a price
  // this product was on sale from, and on some retailers it is not a price at
  // all: this index put The Azure Sea's Seven booster box at $120 was $269,
  // while StockX's own page that day asked $219, with $171 as the last sale
  // and $120 as the box's printed retail. The strike-through invented a 55%
  // discount out of two unrelated fields. A number a reader cannot check is
  // exactly what this screen took the fit percentage out for.
  return <span className="price">{money(data.price, data.currency)}</span>;
}

/**
 * One column per requirement the agent pulled out of the sentence. These are
 * the buyer's own words, which is the one thing a retailer's own filters can
 * never be.
 */
export function requirementColumns(
  requirements: readonly string[],
  narrow = false,
): ColDef<Row>[] {
  // On a narrow screen every pixel a mark column takes is a pixel the price
  // loses off the right edge, so the cap drops with the viewport.
  const cap = narrow ? 124 : 170;
  return requirements.map((text, i) => ({
    headerName: text,
    headerTooltip: text,
    colId: `req-${i}`,
    width: Math.min(cap, Math.max(narrow ? 96 : 110, text.length * 6)),
    // Centred, so the marks read as a matrix across the rows rather than as a
    // dot stranded at the left edge of a wide column.
    cellClass: 'reqcell',
    headerClass: 'reqhead',
    // The buyer's own words are the header; truncating them to "will not glare
    // on a seco…" throws away the one thing this column is for.
    wrapHeaderText: true,
    autoHeaderHeight: true,
    sortable: true,
    // Sorted so the rows that fail this requirement gather at one end.
    valueGetter: (p: ValueGetterParams<Row>) => {
      const m = p.data?.marks[i];
      return m ? (m.holds === 'yes' ? 2 : m.holds === 'unclear' ? 1 : 0) : -1;
    },
    tooltipValueGetter: (p) => {
      const m = (p.data as Row | undefined)?.marks[i];
      if (!m) return 'the agent did not judge this row';
      return `${MARK_WORD[m.holds]}${m.note ? `: ${m.note}` : ''}`;
    },
    cellRenderer: ({ data }: ICellRendererParams<Row>) => {
      const m = data?.marks[i];
      if (!m) return <span className="dash">—</span>;
      return (
        <span className="markcell" title={`${MARK_WORD[m.holds]}${m.note ? `: ${m.note}` : ''}`}>
          <MarkDot holds={m.holds} />
        </span>
      );
    },
  }));
}

export const defaultColDef: ColDef<Row> = {
  resizable: true,
  suppressHeaderMenuButton: true,
};

/** The columns every errand has, whatever was asked for. */
export function baseColumns(narrow = false, anyHold = true): ColDef<Row>[] {
  return [
    {
      headerName: 'Product',
      field: 'title',
      flex: 3,
      minWidth: narrow ? 184 : 240,
      cellRenderer: ProductCell,
      tooltipField: 'title',
      filter: 'agTextColumnFilter',
    },
    {
      // The qualifier does not fit the narrow price column, and truncated to
      // "Price · as i…" it looks like a bug. On a phone the caveat row above the
      // grid carries it instead.
      headerName: narrow ? 'Price' : 'Price · as indexed',
      field: 'price',
      // Wide enough for a price and the struck-through one beside it: at 128
      // the comparison read "$107…", which looks like a bug, not a saving.
      width: narrow ? 120 : 152,
      type: 'numericColumn',
      cellRenderer: PriceCell,
      filter: 'agNumberColumnFilter',
    },
    {
      // On a screen where nothing holds, "why the agent kept it" is the app
      // defending 23 rows it has just ruled against. Same column, honest name.
      headerName: anyHold ? 'Why the agent kept it' : 'Where it falls short',
      field: 'why',
      flex: 2,
      minWidth: 200,
      cellClass: 'whycell',
      filter: 'agTextColumnFilter',
      tooltipField: 'why',
      // Clamped rather than auto-height: a row that grows to fit its prose
      // breaks the pitch the ledger is read across.
      cellRenderer: ({ value }: ICellRendererParams<Row>) => (
        <span className="why2">{value as string}</span>
      ),
    },
    // Not on screen - the retailer's name in the product cell is the link -
    // but the CSV is useless without somewhere to go, so it rides along. It
    // goes last: App.tsx takes the first column by position.
    { headerName: 'Listing', field: 'url', hide: true },
  ];
}
