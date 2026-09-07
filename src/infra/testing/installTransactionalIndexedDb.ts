import { TransactionalPersistence } from './transactionalPersistence';

export type TransactionalIndexedDbInstallation = {
    readonly persistence: TransactionalPersistence;
    dispose: () => Promise<void>;
};

export type InstallTransactionalIndexedDbOptions = {
    autoCompleteReadwrite?: boolean;
};

type TransactionalDatabase = IDBDatabase & {
    onversionchange: (() => void) | null;
};

function waitForMicrotask(): Promise<void> {
    return new Promise((resolve) => queueMicrotask(resolve));
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
    let version = 0;
    let closed = false;

    const database = persistence.database as TransactionalDatabase;
    Object.assign(database, {
        objectStoreNames: {
            contains: (name: string) => storeNames.has(name),
        },
        createObjectStore: (name: string) => {
            storeNames.add(name);
            return undefined;
        },
        onversionchange: null,
        close: () => {
            closed = true;
        },
    });

    const indexedDb = {
        open: (_name: string, requestedVersion?: number) => {
            const request = {
                result: database,
                error: null,
                onblocked: null as (() => void) | null,
                onerror: null as (() => void) | null,
                onsuccess: null as (() => void) | null,
                onupgradeneeded: null as (() => void) | null,
            };
            const needsUpgrade = (requestedVersion ?? 1) > version;
            version = Math.max(version, requestedVersion ?? 1);
            closed = false;
            queueMicrotask(() => {
                if (needsUpgrade) {
                    request.onupgradeneeded?.();
                }
                queueMicrotask(() => request.onsuccess?.());
            });
            return request;
        },
    } as IDBFactory;

    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: indexedDb, writable: true });

    return {
        persistence,
        async dispose(): Promise<void> {
            for (let attempt = 0; attempt < 3; attempt++) {
                if (persistence.getTransactions().every((transaction) => transaction.isSettled())) {
                    break;
                }
                await waitForMicrotask();
            }
            if (!persistence.getTransactions().every((transaction) => transaction.isSettled())) {
                throw new Error('Transactional IndexedDB still has unsettled transactions during cleanup');
            }

            if (!closed) {
                database.onversionchange?.();
                database.close();
            }
            if (indexedDbDescriptor) {
                Object.defineProperty(globalThis, 'indexedDB', indexedDbDescriptor);
            } else {
                Reflect.deleteProperty(globalThis, 'indexedDB');
            }
        },
    };
}
