/** Two verbs on `window.api` over a fixed whitelist — no fs, no path, no Node. That is the sandbox. */

import { Container, createRoot } from 'react-dom/client';
import './index.css';
import App from './renderer/App'

console.log('👋 This message is being logged by "renderer.js", included via webpack');

createRoot(document.getElementById('root') as Container).render(<App />)
