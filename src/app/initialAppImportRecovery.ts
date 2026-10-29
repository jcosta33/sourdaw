export const APP_IMPORT_RETRY_KEY = 'sourdaw:app-import-retry-v1';
export const BOOTSTRAP_STARTED_ATTRIBUTE = 'data-sourdaw-bootstrap-started';
export const APP_RENDER_ISSUED_ATTRIBUTE = 'data-sourdaw-app-render-issued';
export const APP_IMPORT_RETRY_ISSUED_ATTRIBUTE = 'data-sourdaw-app-import-retry-issued';

type RetryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type InitialAppImportRecoveryEnvironment = {
    protocol: string;
    userAgent: string;
    hasDesktopBridge: boolean;
    bootstrapStarted: boolean;
    appRenderIssued: boolean;
    retryIssued: boolean;
    storage: () => RetryStorage;
};

export function claimInitialAppImportRetry(environment: InitialAppImportRecoveryEnvironment): boolean {
    if (
        !['http:', 'https:'].includes(environment.protocol) ||
        environment.hasDesktopBridge ||
        environment.userAgent.includes('Electron/') ||
        environment.bootstrapStarted ||
        environment.appRenderIssued ||
        environment.retryIssued
    ) {
        return false;
    }
    try {
        const storage = environment.storage();
        // Any existing value exhausts the budget; a new document must observe our confirmed write.
        if (storage.getItem(APP_IMPORT_RETRY_KEY) !== null) {
            return false;
        }
        storage.setItem(APP_IMPORT_RETRY_KEY, 'used');
        return storage.getItem(APP_IMPORT_RETRY_KEY) === 'used';
    } catch {
        return false;
    }
}

export function clearInitialAppImportRetry(storage: () => RetryStorage): void {
    try {
        storage().removeItem(APP_IMPORT_RETRY_KEY);
    } catch {
        // Manual reload must remain available when tab storage is unavailable.
    }
}
