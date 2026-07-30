import { logger } from '#/infra/logger/appLogger';

export function reportStartupFailure(error: unknown): void {
    logger.error(new Error('Sourdaw failed to start', { cause: error }));

    const root = document.getElementById('root');
    if (!root) {
        return;
    }

    const alert = document.createElement('div');
    alert.setAttribute('role', 'alert');
    alert.className = 'p-6 text-sm text-foreground';
    alert.textContent = 'Sourdaw failed to start. Reload the page to try again.';
    root.replaceChildren(alert);
}
