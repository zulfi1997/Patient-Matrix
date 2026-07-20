import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/**
 * When Microsoft redirects the OneDrive sign-in popup back to this same URL, this window *is*
 * that popup, not a real visit - MSAL needs to detect that and hand the result back to the
 * window that opened it. Mounting the full app first (which opens IndexedDB connections and
 * renders the whole dashboard before any of that OneDrive code runs) delays that handoff long
 * enough that the popup was staying open showing the dashboard instead of closing itself, so
 * this checks for the auth-response signature and short-circuits straight to MSAL init instead.
 */
const isAuthPopupResponse =
  !!window.opener &&
  window.opener !== window &&
  /[#?](?:[^#]*&)?(code|error)=/.test(`${window.location.hash}${window.location.search}`);

if (isAuthPopupResponse) {
  document.getElementById('root')!.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font:14px system-ui;color:#71717a;">Completing sign-in… this window should close automatically.</div>';
  import('./lib/oneDrive').then(({ getActiveAccount }) => {
    getActiveAccount().catch(() => {});
  });
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
