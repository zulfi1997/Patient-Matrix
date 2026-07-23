/**
 * Uploads to the shared OneDrive folder from an unattended script, using Microsoft Graph's
 * client-credentials ("app-only") flow rather than the interactive MSAL popup sign-in the
 * browser dashboard uses - there's no human present to click through a sign-in/MFA prompt on
 * a scheduled run. This requires its own Azure app registration (a confidential/daemon app
 * with a client secret and an Application permission grant), separate from the SPA app
 * registration used for browser sign-in.
 */

async function getAppOnlyToken({ tenantId, clientId, clientSecret }) {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to get an app-only Graph token (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  const body = await res.json();
  return body.access_token;
}

function encodeShareUrl(url) {
  const base64 = Buffer.from(url, 'utf8').toString('base64').replace(/=/g, '').replace(/\//g, '_').replace(/\+/g, '-');
  return `u!${base64}`;
}

async function graphFetch(url, token, init) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers } });
  if (!res.ok) {
    throw new Error(`OneDrive request failed (${res.status}) for ${url}: ${(await res.text()).slice(0, 500)}`);
  }
  return res.json();
}

async function resolveSharedFolder(sharedFolderUrl, token) {
  const encoded = encodeShareUrl(sharedFolderUrl);
  const item = await graphFetch(`https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem`, token);
  const driveId = item.parentReference?.driveId;
  if (!driveId) throw new Error('Could not resolve the shared OneDrive folder - check the link is still valid.');
  return { driveId, itemId: item.id };
}

async function findSubfolder(root, name, token) {
  const page = await graphFetch(`https://graph.microsoft.com/v1.0/drives/${root.driveId}/items/${root.itemId}/children?$top=200`, token);
  const match = (page.value ?? []).find((c) => !!c.folder && c.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (!match) throw new Error(`Could not find a "${name}" folder inside the shared OneDrive folder.`);
  return { driveId: root.driveId, itemId: match.id };
}

/** Uploads a small file (<4MB - fine for a daily sales export) directly by name into a known parent folder. */
async function uploadFile({ driveId, itemId }, fileName, buffer, token) {
  const encodedName = encodeURIComponent(fileName);
  const res = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}:/${encodedName}:/content`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: buffer,
  });
  if (!res.ok) {
    throw new Error(`Failed to upload "${fileName}" to OneDrive (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  return res.json();
}

export async function uploadToOneDriveFolder({ tenantId, clientId, clientSecret, sharedFolderUrl, subfolderName, fileName, buffer }) {
  const token = await getAppOnlyToken({ tenantId, clientId, clientSecret });
  const root = await resolveSharedFolder(sharedFolderUrl, token);
  const subfolder = await findSubfolder(root, subfolderName, token);
  return uploadFile(subfolder, fileName, buffer, token);
}

/** Lists the .csv/.xlsx files directly inside a named subfolder, newest-modified first. */
async function listFiles({ driveId, itemId }, token) {
  const page = await graphFetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=200&$select=id,name,size,lastModifiedDateTime,file`,
    token,
  );
  return (page.value ?? [])
    .filter((c) => !!c.file && /\.(csv|xlsx|xls)$/i.test(c.name))
    .map((c) => ({ id: c.id, name: c.name, size: c.size, lastModifiedDateTime: c.lastModifiedDateTime }))
    .sort((a, b) => new Date(b.lastModifiedDateTime).getTime() - new Date(a.lastModifiedDateTime).getTime());
}

export async function listOneDriveFolder({ tenantId, clientId, clientSecret, sharedFolderUrl, subfolderName }) {
  const token = await getAppOnlyToken({ tenantId, clientId, clientSecret });
  const root = await resolveSharedFolder(sharedFolderUrl, token);
  const subfolder = await findSubfolder(root, subfolderName, token);
  return listFiles(subfolder, token);
}

async function downloadFile({ driveId }, fileId, token) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${fileId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to download OneDrive file ${fileId} (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Downloads whichever file in the named subfolder was modified most recently - same "pick the newest" rule the browser dashboard's "Pull from OneDrive" uses, since these folders can accumulate more than one export over time. Returns null if the folder has no matching files. */
export async function downloadLatestFromOneDriveFolder({ tenantId, clientId, clientSecret, sharedFolderUrl, subfolderName }) {
  const token = await getAppOnlyToken({ tenantId, clientId, clientSecret });
  const root = await resolveSharedFolder(sharedFolderUrl, token);
  const subfolder = await findSubfolder(root, subfolderName, token);
  const files = await listFiles(subfolder, token);
  if (files.length === 0) return null;
  const latest = files[0];
  const buffer = await downloadFile(subfolder, latest.id, token);
  return { name: latest.name, lastModifiedDateTime: latest.lastModifiedDateTime, buffer };
}
