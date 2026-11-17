import { createHotContext } from '/@vite/client';

const boot = Number(sessionStorage.getItem('boot') ?? '0') + 1;
sessionStorage.setItem('boot', String(boot));
document.documentElement.dataset.boot = String(boot);
const hot = createHotContext('/entry.js');
hot.on('fixture:message', ({ message }) => {
    document.documentElement.dataset.customMessage = message;
});
hot.on('vite:ws:disconnect', () => console.info('fixture-disconnected'));

const { content } = await import('./App.js');
const target = document.getElementById('content');
if (target) {
    target.textContent = content;
}
