/**
 * The demo's only visible addition to the app: a corner pill that says this
 * is a demo, links to the repo, and resets the fake data.
 *
 * Rendered outside React on purpose — it must not become something the real
 * app has to know about or route around.
 */
import { DEMO_KEY } from './mock-api.js';

const REPO = 'https://github.com/chapdad031167/Kids-Reward-Chart-System';

const style = document.createElement('style');
style.textContent = `
.demo-pill {
  position: fixed;
  left: 12px;
  bottom: 12px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 999px;
  background: #1a202ce6;
  color: #fff;
  font: 600 12px/1.2 system-ui, sans-serif;
  box-shadow: 0 4px 14px #0000004d;
  backdrop-filter: blur(4px);
}
.demo-pill a, .demo-pill button {
  color: #90cdf4;
  background: none;
  border: none;
  padding: 4px 6px;
  font: inherit;
  text-decoration: none;
  cursor: pointer;
  border-radius: 6px;
}
.demo-pill button:hover, .demo-pill a:hover { background: #ffffff26; }
.demo-pill .demo-dot { opacity: 0.4; }
@media print { .demo-pill { display: none; } }
`;
document.head.appendChild(style);

const pill = document.createElement('div');
pill.className = 'demo-pill';
pill.innerHTML = `
  <span>🧪 Demo — data is fake and lives in this browser</span>
  <span class="demo-dot">·</span>
  <button type="button" id="demo-reset">Reset</button>
  <span class="demo-dot">·</span>
  <a href="${REPO}" target="_blank" rel="noopener">Source</a>
`;

function mount() {
  document.body.appendChild(pill);
  document.getElementById('demo-reset').addEventListener('click', () => {
    localStorage.removeItem(DEMO_KEY);
    // Drop the hash too, so a reset from deep inside a kid's screen lands
    // back at the avatar picker rather than a screen for a kid that the
    // reseed may have renumbered.
    location.href = location.pathname + location.search;
  });
}

if (document.body) mount();
else document.addEventListener('DOMContentLoaded', mount);
