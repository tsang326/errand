import type { ColDef, ICellRendererParams, ValueGetterParams } from 'ag-grid-community';
import type { Row } from './types';

const money = (value: number | null, currency: string): string =>
  value === null ? '' : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);

/**
 * The agent's confidence, drawn rather than printed: a judged row reads at a
 * glance, and a row the agent never judged shows an em dash, because 0 would
 * claim the agent looked at it and said no.
 */
function FitCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  if (data.fit === null) return <span className="muted">—</span>;
  const tone = data.fit >= 70 ? 'good' : data.fit >= 40 ? 'mixed' : 'bad';
  return (
    <div className="fit">
      <div className={`fit-bar fit-${tone}`} style={{ width: `${data.fit}%` }} />
      <span className="fit-num">{data.fit}</span>
    </div>
  );
}

function ProductCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  return (
    <div className="product">
      {data.imageUrl ? (
        <img src={data.imageUrl} alt={data.title} loading="lazy" />
      ) : (
        <div className="noimg" aria-hidden="true" />
      )}
      <div className="product-text">
        <div className="product-title">{data.title}</div>
        <div className="product-brand">{data.brand || 'no brand given'}</div>
      </div>
    </div>
  );
}

function PriceCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  return (
    <div className="price">
      <span>{money(data.price, data.currency)}</span>
      {data.compareAtPrice !== null && (
        <s className="was">{money(data.compareAtPrice, data.currency)}</s>
      )}
    </div>
  );
}

/** What the agent could not show. An empty cell here is a positive claim. */
function MissesCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  if (data.misses.length === 0) return <span className="muted">none</span>;
  return (
    <div className="chips">
      {data.misses.map((m) => (
        <span className="chip chip-bad" key={m} title={m}>
          {m}
        </span>
      ))}
    </div>
  );
}

function StockCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  return (
    <span className={data.inStock ? 'pill pill-in' : 'pill pill-out'}>
      {data.inStock ? 'in stock' : 'not buyable'}
    </span>
  );
}

export const columns: ColDef<Row>[] = [
  {
    headerName: 'Fit',
    field: 'fit',
    width: 100,
    cellRenderer: FitCell,
    filter: 'agNumberColumnFilter',
    sort: 'desc',
    comparator: (a, b) => (a ?? -1) - (b ?? -1),
    headerTooltip: "The agent's own confidence that this row answers the request",
  },
  {
    headerName: 'Why the agent kept it',
    field: 'why',
    flex: 2,
    minWidth: 260,
    wrapText: true,
    autoHeight: true,
    filter: 'agTextColumnFilter',
    cellClass: 'why-cell',
  },
  {
    headerName: 'Misses',
    field: 'misses',
    flex: 1,
    minWidth: 150,
    // Chips wrap instead of ending in an ellipsis: a half-shown miss
    // ("light temperatur…") is the one thing the shopper must be able to read.
    wrapText: true,
    autoHeight: true,
    cellRenderer: MissesCell,
    filter: 'agTextColumnFilter',
    valueGetter: (p: ValueGetterParams<Row>) => p.data?.misses.join(', ') ?? '',
  },
  {
    headerName: 'Product',
    field: 'title',
    flex: 2,
    minWidth: 280,
    cellRenderer: ProductCell,
    filter: 'agTextColumnFilter',
  },
  {
    headerName: 'Retailer',
    field: 'retailer',
    width: 140,
    filter: 'agTextColumnFilter',
    headerTooltip: 'Channel3 gives the retailer as a domain; there is no display name',
  },
  {
    headerName: 'Price',
    field: 'price',
    width: 120,
    cellRenderer: PriceCell,
    filter: 'agNumberColumnFilter',
    type: 'numericColumn',
  },
  { headerName: 'Stock', field: 'inStock', width: 110, cellRenderer: StockCell },
  {
    headerName: 'Offers',
    field: 'offerCount',
    width: 85,
    type: 'numericColumn',
    filter: 'agNumberColumnFilter',
    headerTooltip: 'How many retailers carry this product',
  },
  {
    headerName: 'Category',
    field: 'category',
    width: 150,
    filter: 'agTextColumnFilter',
    tooltipValueGetter: (p) => p.data?.categoryPath.join(' > ') ?? '',
  },
  {
    headerName: 'Pays',
    field: 'commissionRate',
    width: 85,
    type: 'numericColumn',
    valueFormatter: (p) => (p.value ? `${(Number(p.value) * 100).toFixed(1)}%` : ''),
    headerTooltip: 'Commission Channel3 reports on the best offer',
  },
];

export const defaultColDef: ColDef<Row> = {
  sortable: true,
  resizable: true,
  filter: true,
  floatingFilter: false,
};

export { money };
