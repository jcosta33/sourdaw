import { logger } from '#/infra/logger/appLogger';

/** Abort one exact IDB transaction when its owning queue generation is revoked. */
export function bindTransactionAbortSignal(transaction: IDBTransaction, signal?: AbortSignal): () => void {
    if (!signal) {
        return () => undefined;
    }

    let isListening = false;
    function abortTransaction(): void {
        try {
            transaction.abort();
        } catch (error) {
            if (!(error instanceof DOMException && error.name === 'InvalidStateError')) {
                logger.warn('[CrdtPersistence] Failed to abort superseded IDB transaction:', error);
            }
        }
    }

    if (signal.aborted) {
        abortTransaction();
    } else {
        signal.addEventListener('abort', abortTransaction, { once: true });
        isListening = true;
    }

    return () => {
        if (isListening) {
            signal.removeEventListener('abort', abortTransaction);
        }
    };
}
