import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import { MSAL_CLIENT_ID, MSAL_REDIRECT_URI, MSAL_TENANT_ID, SHARED_FOLDER_URL } from './oneDriveConfig';

const GRAPH_SCOPES = ['Files.Read.All', 'User.Read'];

const msalInstance = new PublicClientApplication({
  auth: {
    clientId: MSAL_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${MSAL_TENANT_ID}`,
    redirectUri: MSAL_REDIRECT_URI,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
});

let initPromise: Promise<void> | null = null;
function ensureInitialized(): Promise<void> {
  if (!initPromise) initPromise = msalInstance.initialize();
  return initPromise;
}

function currentAccount(): AccountInfo | null {
  return msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0] ?? null;
}

export async function getActiveAccount(): Promise<AccountInfo | null> {
  await ensureInitialized();
  return currentAccount();
}

export async function signIn(): Promise<AccountInfo> {
  await ensureInitialized();
  const result = await msalInstance.loginPopup({ scopes: GRAPH_SCOPES });
  msalInstance.setActiveAccount(result.account);
  return result.account;
}

export async function signOut(): Promise<void> {
  await ensureInitialized();
  const account = currentAccount();
  if (account) await msalInstance.logoutPopup({ account });
}

async function getAccessToken(): Promise<string> {
  await ensureInitialized();
  const account = currentAccount();
  if (!account) throw new Error('Not signed in to Microsoft.');
  try {
    const result = await msalInstance.acquireTokenSilent({ scopes: GRAPH_SCOPES, account });
    return result.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      const result = await msalInstance.acquireTokenPopup({ scopes: GRAPH_SCOPES, account });
      return result.accessToken;
    }
    throw e;
  }
}

/** Microsoft Graph's "encoded sharing URL" format for resolving a share link to a DriveItem: base64url of the raw URL, prefixed "u!". */
function encodeShareUrl(url: string): string {
  const base64 = btoa(url).replace(/=/g, '').replace(/\//g, '_').replace(/\+/g, '-');
  return `u!${base64}`;
}

interface GraphDriveItem {
  id: string;
  name: string;
  folder?: unknown;
  file?: unknown;
  parentReference?: { driveId?: string };
}

interface DriveItemRef {
  driveId: string;
  itemId: string;
}

async function graphFetch<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`OneDrive request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

let sharedFolderRef: DriveItemRef | null = null;

async function resolveSharedFolder(token: string): Promise<DriveItemRef> {
  if (sharedFolderRef) return sharedFolderRef;
  const encoded = encodeShareUrl(SHARED_FOLDER_URL);
  const item = await graphFetch<GraphDriveItem>(`https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem`, token);
  const driveId = item.parentReference?.driveId;
  if (!driveId) throw new Error('Could not resolve the shared OneDrive folder - check the link is still valid.');
  sharedFolderRef = { driveId, itemId: item.id };
  return sharedFolderRef;
}

async function listChildren(ref: DriveItemRef, token: string): Promise<GraphDriveItem[]> {
  const page = await graphFetch<{ value: GraphDriveItem[] }>(
    `https://graph.microsoft.com/v1.0/drives/${ref.driveId}/items/${ref.itemId}/children?$top=200`,
    token,
  );
  return page.value;
}

async function findSubfolder(root: DriveItemRef, name: string, token: string): Promise<DriveItemRef> {
  const children = await listChildren(root, token);
  const match = children.find((c) => !!c.folder && c.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (!match) {
    throw new Error(`Could not find a "${name}" folder inside the shared OneDrive folder.`);
  }
  return { driveId: root.driveId, itemId: match.id };
}

async function downloadFile(ref: DriveItemRef, name: string, token: string): Promise<File> {
  const res = await fetch(`https://graph.microsoft.com/v1.0/drives/${ref.driveId}/items/${ref.itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to download "${name}" from OneDrive (${res.status}).`);
  const blob = await res.blob();
  return new File([blob], name);
}

/**
 * Every Excel/CSV file currently inside the named subfolder of the shared OneDrive root,
 * downloaded as File objects - ready to feed through the same import functions used for a
 * manual multi-file upload.
 */
export async function pullFilesFromOneDrive(subfolderName: string): Promise<File[]> {
  const token = await getAccessToken();
  const root = await resolveSharedFolder(token);
  const subfolder = await findSubfolder(root, subfolderName, token);
  const children = await listChildren(subfolder, token);
  const files = children.filter((c) => !!c.file && /\.(xlsx|xls|csv)$/i.test(c.name));
  return Promise.all(files.map((f) => downloadFile({ driveId: subfolder.driveId, itemId: f.id }, f.name, token)));
}
