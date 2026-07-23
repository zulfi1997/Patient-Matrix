# Patient Matrix MCP server

Lets an MCP client (Claude Desktop, Claude Code, etc.) ask for real sales facts in chat, without
opening the dashboard. It reuses the exact same code the app and the "Zenoti Sales Sync" GitHub
Action already use, so numbers here always match what the dashboard would show for the same
period - nothing here is a reimplementation that could drift.

## Tools

- **`get_sales_facts`** - `{ since?, until? }` (`YYYY-MM-DD`, defaults to the last 30 days).
  Pulls live sales lines directly from the Zenoti API (not the daily OneDrive export cycle, so
  it's up-to-the-minute) and reports total revenue, transactions, unique patients, top services,
  package redemption value, and a revenue-by-department breakdown - using the latest "Department
  Mapping" and "Package Benefit Data" files from the shared OneDrive folder, resolved the same way
  the Department Analytics dashboard does (direct mapping first, then a package's benefits, split
  proportionally across departments for a genuinely mixed package).
- **`list_onedrive_reports`** - `{ folder? }` (`sales` | `pnl` | `packageBenefits` |
  `departmentMapping`, omit for all four). Lists what files currently sit in each shared OneDrive
  subfolder and when they were last modified.

## Setup

1. From the repo root: `npm install` (installs `@modelcontextprotocol/sdk` and `tsx` alongside the
   app's existing dependencies).
2. Create `mcp-server/.env` (see `.env.example` in this folder) with the same credentials the
   "Zenoti Sales Sync" GitHub Action uses (`Settings -> Secrets and variables -> Actions` on the
   repo has the values already, or ask whoever set that workflow up):

   | Variable | Where it comes from |
   |---|---|
   | `ZENOTI_API_KEY` | Zenoti API key (same as the sync workflow's `ZENOTI_API_KEY` secret) |
   | `ZENOTI_CENTER_IDS` | Comma-separated center IDs (same as the sync workflow's secret) |
   | `ZENOTI_API_HOST` | Optional - only if not using the default `https://api.zenoti.com` |
   | `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | The Azure app-only (client-credentials) registration used for the scheduled sync - same values as the workflow's secrets |
   | `ONEDRIVE_SHARED_FOLDER_URL` | The same shared OneDrive folder link the app and sync workflow use |

   These are the same daemon-app Graph credentials as the sync workflow - not the browser SPA
   sign-in the dashboard itself uses - because there's no human present to click through a sign-in
   prompt.

3. Point your MCP client at it. For Claude Desktop, add to its config
   (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
   `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

   ```json
   {
     "mcpServers": {
       "patient-matrix": {
         "command": "npx",
         "args": ["tsx", "mcp-server/index.ts"],
         "cwd": "/absolute/path/to/Patient-Matrix",
         "env": {
           "ZENOTI_API_KEY": "...",
           "ZENOTI_CENTER_IDS": "...",
           "GRAPH_TENANT_ID": "...",
           "GRAPH_CLIENT_ID": "...",
           "GRAPH_CLIENT_SECRET": "...",
           "ONEDRIVE_SHARED_FOLDER_URL": "..."
         }
       }
     }
   }
   ```

   For Claude Code, run `claude mcp add patient-matrix -- npx tsx mcp-server/index.ts` from the
   repo root (it will pick up `mcp-server/.env` if you use a tool like `dotenv-cli`, or pass `--env`
   flags / set the variables in your shell profile).

4. Restart the client. You should see `get_sales_facts` and `list_onedrive_reports` available as
   tools.

## Notes / current scope

- This is a **local, stdio-transport** server - it runs on your own machine, and the credentials
  above never leave it. There's no hosted/remote version.
- `get_sales_facts` needs Graph read access to list and download files (in addition to the upload
  access the sync workflow's app registration already has) - if your Azure app registration only
  has upload (`Files.ReadWrite.All` should already cover both, but a narrower custom permission
  grant might not) you may need to add read scopes.
- If no "Department Mapping" file is found in OneDrive, all revenue is reported as "Unmapped"
  rather than the tool failing - map services on the dashboard's Data tab and re-export to fix
  this.
