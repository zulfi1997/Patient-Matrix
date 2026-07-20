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
 *
 * Deliberately does NOT also require `window.opener` to still be set: Microsoft's login pages
 * commonly send a Cross-Origin-Opener-Policy header that severs that reference once the popup
 * navigates there, even though the window genuinely is the popup - the URL's code=/error=/state=
 * signature is the reliable signal here, since this app never puts those in its own URL.
 */
const isAuthPopupResponse = /[#?](?:[^#&]*&)*(code|error|state)=/.test(
  `${window.location.hash}${window.location.search}`,
);

if (isAuthPopupResponse) {
  document.getElementById('root')!.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font:14px system-ui;color:#71717a;">Completing sign-in… this window should close automatically.</div>';
  // This is the piece that actually hands the auth result back to the opener: it parses the
  // response out of this popup's URL, posts it over the BroadcastChannel the opener's
  // loginPopup() call is listening on, and closes this window. Without calling it, this popup
  // was just showing a placeholder forever - nothing was ever sent back, so the opener's wait
  // would time out no matter how long that timeout was set to.
  import('@azure/msal-browser/redirect-bridge').then(({ broadcastResponseToMainFrame }) => {
    broadcastResponseToMainFrame().catch(() => {});
  });
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
