import { logger } from '#/infra/logger/appLogger';

import { createAssetTransferResumeRepository } from '../repositories/assetTransferResumeRepository';

const EXPIRY_INTERVAL_MS = 60 * 60 * 1000;

/** Age expiry is cache-only; no absence of project references is inferred here. */
export function startAssetBitmapLifecycle(): () => void {
    const repository = createAssetTransferResumeRepository('temporary-cache-expiry');
    let stopped = false;
    let pending: Promise<void> | undefined;
    function sweep(): void {
        if (stopped || pending) {
            return;
        }
        pending = repository
            .expire()
            .then(() => undefined)
            .catch((error: unknown) => {
                logger.warn('[Collaboration] Partial asset expiry could not finish:', error);
            })
            .finally(() => {
                pending = undefined;
            });
    }
    sweep();
    const timer = setInterval(sweep, EXPIRY_INTERVAL_MS);
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}
