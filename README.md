# Patient Matrix — Clinic Performance Dashboard

A browser-only dashboard for tracking patient retention, turnover, new
patients, and service performance from clinic sales exports (built for a
Zenoti-based derma & wellness clinic). All data stays in your browser
(IndexedDB) — nothing is uploaded to a server.

## Using it

1. Run the app (see below) and open the **Data** tab.
2. Upload the full historical sales export (Excel `.xlsx`) once — this can
   be a large "from inception to date" file.
3. On subsequent days, export and upload just the latest data from your POS.
   The importer detects rows it has already seen (by invoice + line item)
   and skips them automatically, so it's safe to upload overlapping or
   cumulative exports — you won't get duplicates.
4. Switch to the **Dashboard** tab to see:
   - KPIs: revenue, active/new/returning patients, retention rate, turnover
     rate (all compared against the previous equivalent period).
   - New vs returning patients and revenue trends over the last 12 months.
   - Top selling services/products/packages, and which ones haven't sold
     recently ("dormant" services), for a chosen category.
   - A searchable, exportable list of patients who've stopped visiting
     (configurable inactivity threshold).

**Expected columns**: Sale Date, Guest Code, Guest Name, Item Type, Item
Name, Invoice No, Sales (Exc. Tax) are required; Item Code, Item
Subcategory, Qty, Sales(Inc. Tax), Tax, Invoice status, Payment Type, Sold
By/Therapist, Center Name are used when present. This matches a standard
Zenoti sales export.

**Data lives in this browser only.** Use "Backup all data (CSV)" on the
Data tab periodically, and note that data won't carry over to another
device or browser — if that becomes a problem, this can be upgraded to a
server + database backed version, e.g. once ready to connect the sales
system directly via API.

## Development

```bash
npm install
npm run dev      # start dev server
npm run build    # typecheck + production build
npm run lint     # oxlint
```

Tech: Vite + React + TypeScript, Tailwind CSS, Recharts, SheetJS (`xlsx`)
for parsing, `idb` for IndexedDB persistence.
