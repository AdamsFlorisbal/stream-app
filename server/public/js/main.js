import { DeckApp } from './DeckApp.js';

/**
 * Ponto de entrada do aplicativo.
 * Mantido minimo de proposito: toda a logica vive nas classes de componente.
 */
const app = new DeckApp();
app.start().catch((err) => {
  console.error('falha ao iniciar o Deck Control', err);
  document.body.insertAdjacentHTML('beforeend',
    `<div style="position:fixed;inset:auto 16px 16px;z-index:99;padding:14px 16px;border-radius:12px;
       background:#2a0d12;border:1px solid #7f1d1d;color:#fecaca;font:14px system-ui">
       Nao foi possivel iniciar: ${err.message}
     </div>`);
});

// O service worker mantem a interface aberta quando o Wi-Fi oscila.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
