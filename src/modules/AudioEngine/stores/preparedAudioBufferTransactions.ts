export type PreparedTransactionRole = 'discard' | 'persistence' | 'promotion' | 'reclamation' | 'reconciliation';

export type PreparedTransaction = {
    role: PreparedTransactionRole;
    transaction: IDBTransaction;
};

export function awaitPreparedRequest<Result>(request: IDBRequest<Result>): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
    });
}

export function awaitPreparedTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('IDB transaction aborted'));
        transaction.onerror = () => reject(transaction.error ?? new Error('IDB transaction failed'));
    });
}

export function abortPreparedTransaction(transaction: IDBTransaction): Promise<void> {
    const settled = awaitPreparedTransaction(transaction);
    transaction.abort();
    return settled;
}

export function createPreparedAudioBufferTransactionLedger() {
    const activeTransactionsById = new Map<string, Set<PreparedTransaction>>();

    function track(id: string, role: PreparedTransactionRole, transaction: IDBTransaction): PreparedTransaction {
        const tracked = { role, transaction };
        const transactions = activeTransactionsById.get(id) ?? new Set<PreparedTransaction>();
        transactions.add(tracked);
        activeTransactionsById.set(id, transactions);
        return tracked;
    }

    function untrack(id: string, tracked: PreparedTransaction | undefined): void {
        if (!tracked) {
            return;
        }
        const transactions = activeTransactionsById.get(id);
        transactions?.delete(tracked);
        if (transactions?.size === 0) {
            activeTransactionsById.delete(id);
        }
    }

    function abort(id: string, role: PreparedTransactionRole): void {
        for (const tracked of activeTransactionsById.get(id) ?? []) {
            if (tracked.role !== role) {
                continue;
            }
            try {
                tracked.transaction.abort();
            } catch {
                // The exact transaction committed before invalidation reached it.
            }
        }
    }

    function abortAll(role: PreparedTransactionRole): void {
        for (const id of activeTransactionsById.keys()) {
            abort(id, role);
        }
    }

    return { abort, abortAll, track, untrack };
}
