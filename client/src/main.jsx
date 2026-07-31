import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// PWA: production builds register the service worker for installability and
// offline resilience. Fails silently where unsupported. Skipped in the demo,
// which ships no /sw.js — and whose absolute path would resolve to the root
// of the GitHub Pages site rather than to the demo's own directory.
if (import.meta.env.PROD && !import.meta.env.VITE_DEMO && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
