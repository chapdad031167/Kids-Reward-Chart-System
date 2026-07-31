/**
 * Demo entry point. The import order matters: mock-api.js replaces
 * window.fetch as a side effect of being imported, and it has to be in place
 * before the app's first request goes out.
 */
import './mock-api.js';
import './banner.js';
import '../src/main.jsx';
