import { TransactionalPersistence, type TransactionalPersistenceDatabase } from './transactionalPersistence';

export type TransactionalIndexedDbInstallation = {
    readonly persistence: TransactionalPersistence;
    dispose: () => Promise<void>;
};

export type InstallTransactionalIndexedDbOptions = {
    autoCompleteReadwrite?: boolean;
};

type TransactionalDatabase = {
    transaction: TransactionalPersistenceDatabase['transaction'];
    objectStoreNames: { contains: (name: string) => boolean };
    createObjectStore: (name: string) => undefined;
    onversionchange: (() => void) | null;
    close: () => void;
};

type OpenRequest = {
    result: TransactionalDatabase;
    error: null;
    onblocked: (() => void) | null;
    onerror: (() => void) | null;
    onsuccess: (() => void) | null;
    onupgradeneeded: (() => void) | null;
};

type OpenLifecycle = {
    request: OpenRequest;
    cancelled: boolean;
};

type AdapterState = {
    version: number;
    disposed: boolean;
};

function createUnsettledTransactionError(): Error {
    return new Error('Transactional IndexedDB still has unsettled transactions during cleanup');
}

function cancelOpen(pendingOpens: Set<OpenLifecycle>, lifecycle: OpenLifecycle): void {
    lifecycle.cancelled = true;
    pendingOpens.delete(lifecycle);
}

function canDispatchOpen(state: AdapterState, lifecycle: OpenLifecycle): boolean {
    return !state.disposed && !lifecycle.cancelled;
}

function restoreIndexedDbGlobal(indexedDbDescriptor: PropertyDescriptor | undefined): void {
    if (indexedDbDescriptor) {
        Object.defineProperty(globalThis, 'indexedDB', indexedDbDescriptor);
        return;
    }
    Reflect.deleteProperty(globalThis, 'indexedDB');
}

function invalidateConnections(connections: Set<TransactionalDatabase>): unknown {
    let firstError: unknown;
    for (const connection of connections) {
        try {
            connection.onversionchange?.();
        } catch (error) {
            firstError ??= error;
        }
        try {
            connection.close();
        } catch (error) {
            firstError ??= error;
        }
    }
    return firstError;
}

function createIndexedDbFactory({
    connections,
    database,
    pendingOpens,
    state,
}: {
    connections: Set<TransactionalDatabase>;
    database: TransactionalDatabase;
    pendingOpens: Set<OpenLifecycle>;
    state: AdapterState;
}) {
    return {
        open: (_name: string, requestedVersion?: number) => {
            const request: OpenRequest = {
                result: database,
                error: null,
                onblocked: null,
                onerror: null,
                onsuccess: null,
                onupgradeneeded: null,
            };
            const lifecycle: OpenLifecycle = { request, cancelled: false };
            const needsUpgrade = (requestedVersion ?? 1) > state.version;
            state.version = Math.max(state.version, requestedVersion ?? 1);
            pendingOpens.add(lifecycle);

            queueMicrotask(() => {
                if (!canDispatchOpen(state, lifecycle)) {
                    cancelOpen(pendingOpens, lifecycle);
                    return;
                }
                if (needsUpgrade) {
                    request.onupgradeneeded?.();
                }
                queueMicrotask(() => {
                    if (!canDispatchOpen(state, lifecycle)) {
                        cancelOpen(pendingOpens, lifecycle);
                        return;
                    }
                    pendingOpens.delete(lifecycle);
                    connections.add(database);
                    request.onsuccess?.();
                });
            });
            return request;
        },
    };
}

/**
 * Installs an IndexedDB-shaped boundary over isolated atomic byte records.
 * The production repository still opens its database and owns every write;
 * the fixture only supplies the browser API that test environments omit.
 */
export function installTransactionalIndexedDb(
    options: InstallTransactionalIndexedDbOptions = {}
): TransactionalIndexedDbInstallation {
    const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    const persistence = new TransactionalPersistence({ autoCompleteReadwrite: options.autoCompleteReadwrite ?? true });
    const storeNames = new Set<string>();
    const pendingOpens = new Set<OpenLifecycle>();
    const connections = new Set<TransactionalDatabase>();
    const state: AdapterState = { version: 0, disposed: false };

    const database: TransactionalDatabase = {
        transaction: persistence.database.transaction,
        objectStoreNames: {
            contains: (name) => storeNames.has(name),
        },
        createObjectStore: (name) => {
            storeNames.add(name);
            return undefined;
        },
        onversionchange: null,
        close: () => undefined,
    };
    const indexedDb = createIndexedDbFactory({ connections, database, pendingOpens, state });

    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: indexedDb, writable: true });

    return {
        persistence,
        async dispose(): Promise<void> {
            state.disposed = true;
            for (const lifecycle of pendingOpens) {
                cancelOpen(pendingOpens, lifecycle);
            }

            const unsettledTransaction = persistence.getTransactions().some((transaction) => !transaction.isSettled());
            const cleanupError = invalidateConnections(connections);
            restoreIndexedDbGlobal(indexedDbDescriptor);

            if (unsettledTransaction) {
                throw createUnsettledTransactionError();
            }
            if (cleanupError instanceof Error) {
                throw cleanupError;
            }
            if (cleanupError !== undefined) {
                throw new Error('Transactional IndexedDB cleanup failed', { cause: cleanupError });
            }
        },
    };
}
