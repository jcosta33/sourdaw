import { type DurableAssetRecoveryFence } from './durableAssetRepositoryContract';

/** Bind one recovery transaction to its revocable project-load authority. */
export function createDurableAssetRecoveryFenceGuard(fence?: DurableAssetRecoveryFence) {
    const isCurrent = () => fence === undefined || (!fence.signal.aborted && fence.isCurrent());

    const abort = (transaction: IDBTransaction) => {
        try {
            transaction.abort();
        } catch (error) {
            if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') {
                throw error;
            }
        }
    };

    return {
        isCurrent,
        abort,
        bind(transaction: IDBTransaction, completion: Promise<void>): void {
            if (!fence) {
                return;
            }
            const abortBoundTransaction = () => abort(transaction);
            const release = () => fence.signal.removeEventListener('abort', abortBoundTransaction);
            fence.signal.addEventListener('abort', abortBoundTransaction, { once: true });
            if (!isCurrent()) {
                abort(transaction);
            }
            void completion.then(release, release);
        },
    };
}
