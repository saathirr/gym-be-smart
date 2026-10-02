import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// GitHub Pages cannot rewrite unknown paths to index.html, so it answers a
// refresh on a client-side route with 404.html. That file stashes the path the
// visitor asked for; put it back now, before BrowserRouter reads the location,
// so the deep link survives the round trip instead of landing on the dashboard.
function restoreDeepLink() {
  try {
    const saved = window.sessionStorage.getItem('besmart.deeplink');
    if (!saved) return;
    window.sessionStorage.removeItem('besmart.deeplink');

    const url = new URL(saved, window.location.origin);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname) return;

    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch (error) {
    /* private mode or an old browser, nothing to restore. */
  }
}

restoreDeepLink();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
