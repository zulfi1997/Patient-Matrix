export interface FetchAllSalesOptions {
  host?: string;
  apiKey: string;
  centerIds: string[];
  since: Date;
  until: Date;
  itemTypes?: number[];
  saleTypes?: number[];
  invoiceStatuses?: number[];
}

/** Raw Zenoti sales-report row shape - see transform.mjs for the fields actually read from it. */
export type ZenotiRawSaleRow = Record<string, unknown>;

export function fetchAllSales(options: FetchAllSalesOptions): Promise<ZenotiRawSaleRow[]>;
