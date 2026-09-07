import { IDBFactory } from 'fake-indexeddb';

export type TransactionalIndexedDbInstallation = {
    dispose: () => Promise<void>;
};

type TrackedConnection = {
    database: IDBDatabase;
    versionchangeObserved: boolean;
};

type InstallationState = {
    blockedOpenNames: Set<string>;
    closing: boolean;
    connections: Set<TrackedConnection>;
    disposePromise: Promise<void> | null;
    factory: IDBFactory;
    names: Set<string>;
    openSettlements: Set<Promise<void>>;
    originalDescriptor: PropertyDescriptor | undefined;
    operationErrors: unknown[];
    transactionSettlements: Set<Promise<void>>;
};

let activeInstallation: InstallationState | null = null;
let failedTeardown: unknown;

function createLifecycleError(message: string, cause?: unknown): Error {
    return cause === undefined ? new Error(message) : new Error(message, { cause });
}

function normalizeError(error: unknown, message: string): Error {
    return error instanceof Error ? error : createLifecycleError(message, error);
}

function restoreIndexedDbGlobal(state: InstallationState): void {
    const currentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    if (currentDescriptor?.value !== state.factory) {
        return;
    }

    if (state.originalDescriptor) {
        Object.defineProperty(globalThis, 'indexedDB', state.originalDescriptor);
        return;
    }
    Reflect.deleteProperty(globalThis, 'indexedDB');
}

function installIndexedDbGlobal(factory: IDBFactory, originalDescriptor: PropertyDescriptor | undefined): void {
    if (originalDescriptor && !originalDescriptor.configurable) {
        if (!('value' in originalDescriptor) || !originalDescriptor.writable) {
            throw createLifecycleError('The existing IndexedDB global cannot be replaced by this fixture');
        }
        Object.defineProperty(globalThis, 'indexedDB', { ...originalDescriptor, value: factory });
        return;
    }

    Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        enumerable: originalDescriptor?.enumerable ?? false,
        value: factory,
        writable: true,
    });
}

function trackTransaction(state: InstallationState, transaction: IDBTransaction): void {
    let settle!: () => void;
    const settlement = new Promise<void>((resolve) => {
        settle = resolve;
    });
    let settled = false;
    const finish = () => {
        if (settled) {
            return;
        }
        settled = true;
        transaction.removeEventListener('complete', finish);
        transaction.removeEventListener('abort', finish);
        settle();
    };
    transaction.addEventListener('complete', finish);
    transaction.addEventListener('abort', finish);
    state.transactionSettlements.add(settlement);
}

function trackConnection(state: InstallationState, database: IDBDatabase): void {
    for (const connection of state.connections) {
        if (connection.database === database) {
            return;
        }
    }

    const connection: TrackedConnection = { database, versionchangeObserved: false };
    state.connections.add(connection);
    database.addEventListener('versionchange', () => {
        connection.versionchangeObserved = true;
    });

    const transaction = database.transaction.bind(database);
    database.transaction = (storeNames, mode, options) => {
        const created = transaction(storeNames, mode, options);
        trackTransaction(state, created);
        return created;
    };
}

function closeVersionchangedConnections(state: InstallationState, name: string): void {
    for (const connection of state.connections) {
        if (connection.database.name !== name || !connection.versionchangeObserved) {
            continue;
        }
        try {
            connection.database.close();
        } catch (error) {
            state.operationErrors.push(error);
        }
    }
}

function trackOpenRequest(state: InstallationState, name: string, request: IDBOpenDBRequest): void {
    const settlement = new Promise<void>((resolve) => {
        const finish = () => {
            request.removeEventListener('success', handleSuccess);
            request.removeEventListener('error', handleError);
            queueMicrotask(resolve);
        };
        const handleSuccess = () => {
            trackConnection(state, request.result);
            finish();
        };
        const handleError = () => {
            state.operationErrors.push(request.error ?? createLifecycleError('IndexedDB open failed without an error'));
            finish();
        };

        request.addEventListener('upgradeneeded', () => {
            trackConnection(state, request.result);
            if (request.transaction) {
                trackTransaction(state, request.transaction);
            }
        });
        request.addEventListener('blocked', () => {
            state.blockedOpenNames.add(name);
            if (state.closing) {
                closeVersionchangedConnections(state, name);
            }
        });
        request.addEventListener('success', handleSuccess);
        request.addEventListener('error', handleError);
    });
    state.openSettlements.add(settlement);
}

function instrumentFactory(state: InstallationState): void {
    const open = state.factory.open.bind(state.factory);
    state.factory.open = (name, version) => {
        if (state.closing) {
            throw createLifecycleError('Transactional IndexedDB installation is closing');
        }

        state.names.add(name);
        const request = version === undefined ? open(name) : open(name, version);
        trackOpenRequest(state, name, request);
        return request;
    };
}

function deleteDatabase(state: InstallationState, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = state.factory.deleteDatabase(name);
        request.addEventListener('blocked', () => {
            closeVersionchangedConnections(state, name);
        });
        request.addEventListener('error', () => {
            reject(request.error ?? createLifecycleError(`IndexedDB deletion failed for ${name}`));
        });
        request.addEventListener('success', () => resolve());
    });
}

function closeAllConnections(state: InstallationState): void {
    for (const connection of state.connections) {
        try {
            connection.database.close();
        } catch (error) {
            state.operationErrors.push(error);
        }
    }
}

async function disposeInstallation(state: InstallationState): Promise<void> {
    state.closing = true;
    for (const name of state.blockedOpenNames) {
        closeVersionchangedConnections(state, name);
    }

    let teardownError: unknown;
    try {
        await Promise.all(state.openSettlements);
        const deletions = await Promise.allSettled([...state.names].map((name) => deleteDatabase(state, name)));
        teardownError = deletions.find((result) => result.status === 'rejected')?.reason;
        if (teardownError !== undefined) {
            closeAllConnections(state);
        }
        await Promise.all(state.transactionSettlements);
    } catch (error) {
        teardownError = error;
        closeAllConnections(state);
        await Promise.all(state.transactionSettlements);
    } finally {
        try {
            restoreIndexedDbGlobal(state);
        } catch (error) {
            teardownError ??= error;
        }
    }

    const operationError = state.operationErrors[0];
    if (teardownError !== undefined) {
        const error = normalizeError(teardownError, 'Transactional IndexedDB teardown failed');
        failedTeardown = error;
        throw error;
    }

    activeInstallation = null;
    if (operationError !== undefined) {
        throw normalizeError(operationError, 'Transactional IndexedDB operation failed during teardown');
    }
}

/**
 * Installs an isolated IndexedDB factory for tests that exercise the production
 * browser persistence path.
 */
export function installTransactionalIndexedDb(): TransactionalIndexedDbInstallation {
    if (activeInstallation) {
        if (failedTeardown !== undefined) {
            throw createLifecycleError('A previous transactional IndexedDB teardown did not complete', failedTeardown);
        }
        throw createLifecycleError('A transactional IndexedDB installation is already active');
    }
    if (failedTeardown !== undefined) {
        throw createLifecycleError('A previous transactional IndexedDB teardown did not complete', failedTeardown);
    }

    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    const state: InstallationState = {
        blockedOpenNames: new Set(),
        closing: false,
        connections: new Set(),
        disposePromise: null,
        factory: new IDBFactory(),
        names: new Set(),
        openSettlements: new Set(),
        operationErrors: [],
        originalDescriptor,
        transactionSettlements: new Set(),
    };
    instrumentFactory(state);
    installIndexedDbGlobal(state.factory, originalDescriptor);
    activeInstallation = state;

    return {
        dispose(): Promise<void> {
            state.disposePromise ??= disposeInstallation(state);
            return state.disposePromise;
        },
    };
}
