/**
 * Azure AD app registration + shared OneDrive folder for the optional "Pull from OneDrive"
 * import path. The client ID and tenant ID are not secrets - Microsoft's single-page-app auth
 * model expects both to be visible in browser-delivered JS. The shared folder link is safe to
 * ship here too: it's shared with "People in Bio Thrive" only, so opening it still requires a
 * valid Microsoft sign-in and org membership - the link alone grants nothing.
 */
export const MSAL_CLIENT_ID = '0726e794-86b3-497d-bcd6-c847288d21a9';
export const MSAL_TENANT_ID = '05fdc9c2-baec-4f98-829f-e1a021371607';
export const MSAL_REDIRECT_URI = 'https://zulfi1997.github.io/Patient-Matrix/';

export const SHARED_FOLDER_URL =
  'https://biothirve-my.sharepoint.com/:f:/r/personal/zulfi_biothrive-int_com/Documents/Dashboard?csf=1&web=1&e=f4rXfd';

/** Subfolder names inside the shared root folder - every Excel/CSV file inside each is imported through the same pipeline as a manual upload. */
export const ONEDRIVE_SUBFOLDERS = {
  sales: 'Sales Data',
  pnl: 'P&L Data',
  packageBenefits: 'Package Benefit Data',
  departmentMapping: 'Department Mapping',
  collections: 'Collections',
  masterControl: 'Master Control',
} as const;
