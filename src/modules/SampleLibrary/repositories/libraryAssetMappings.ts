type LibraryAssetBinding = {
    hash: string;
    sampleId: string;
    libraryRootId: string;
    relativePath: string;
};

type StoredBinding = LibraryAssetBinding & { schemaVersion: 1; localPeerSettingsId: string };

const DATABASE = 'sourdaw-library-asset-mappings';
const SETTINGS = 'settings';
const MAPPINGS = 'mappings';
const IDENTITY_KEY = 'localPeerSettingsId';

function isBoundedString(value: unknown, maximum: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function isBinding(value: unknown): value is StoredBinding {
    if (!value || typeof value !== 'object') {
        return false;
    }
    return (
        'schemaVersion' in value &&
        value.schemaVersion === 1 &&
        'localPeerSettingsId' in value &&
        isBoundedString(value.localPeerSettingsId, 36) &&
        'hash' in value &&
        typeof value.hash === 'string' &&
        /^sha256:[a-f0-9]{64}$/.test(value.hash) &&
        'sampleId' in value &&
        isBoundedString(value.sampleId, 512) &&
        'libraryRootId' in value &&
        isBoundedString(value.libraryRootId, 512) &&
        'relativePath' in value &&
        isBoundedString(value.relativePath, 4096)
    );
}

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
            reject(new Error('Local library asset settings are unavailable'));
            return;
        }
        const request = indexedDB.open(DATABASE, 1);
        let rejected = false;
        const fail = (error: unknown) => {
            rejected = true;
            reject(error);
        };
        request.onupgradeneeded = () => {
            request.result.createObjectStore(SETTINGS);
            request.result.createObjectStore(MAPPINGS);
        };
        request.onblocked = () => fail(new Error('Local library asset settings upgrade is blocked'));
        request.onerror = () => fail(request.error ?? new Error('Local library asset settings could not be opened'));
        request.onsuccess = () => {
            const database = request.result;
            if (rejected) {
                database.close();
                return;
            }
            database.onversionchange = () => database.close();
            resolve(database);
        };
    });
}

function getLocalPeerSettingsId(database: IDBDatabase, isCurrent: () => boolean): Promise<string | null> {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(SETTINGS, 'readwrite');
        const store = transaction.objectStore(SETTINGS);
        const request = store.get(IDENTITY_KEY);
        let identity: string | null = null;
        let invalidIdentity = false;
        request.onsuccess = () => {
            if (!isCurrent()) {
                transaction.abort();
                return;
            }
            const value: unknown = request.result;
            if (value === undefined) {
                identity = crypto.randomUUID();
                store.put(identity, IDENTITY_KEY);
            } else if (typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)) {
                identity = value;
            } else {
                invalidIdentity = true;
                transaction.abort();
            }
        };
        transaction.oncomplete = () => resolve(isCurrent() ? identity : null);
        transaction.onabort = () => {
            if (!isCurrent()) {
                resolve(null);
                return;
            }
            if (invalidIdentity) {
                reject(new Error('Local library asset settings identity is invalid'));
                return;
            }
            reject(transaction.error ?? new Error('Local library asset settings identity was not committed'));
        };
    });
}

async function rememberBinding(binding: LibraryAssetBinding, isCurrent: () => boolean): Promise<boolean> {
    const database = await openDatabase();
    try {
        if (!isCurrent()) {
            return false;
        }
        const identity = await getLocalPeerSettingsId(database, isCurrent);
        if (!identity || !isCurrent()) {
            return false;
        }
        const row: StoredBinding = {
            schemaVersion: 1,
            localPeerSettingsId: identity,
            hash: binding.hash,
            sampleId: binding.sampleId,
            libraryRootId: binding.libraryRootId,
            relativePath: binding.relativePath,
        };
        if (!isBinding(row)) {
            return false;
        }
        return await new Promise<boolean>((resolve, reject) => {
            const transaction = database.transaction(MAPPINGS, 'readwrite');
            const request = transaction.objectStore(MAPPINGS).put(row, [identity, binding.hash]);
            request.onsuccess = () => {
                if (!isCurrent()) {
                    transaction.abort();
                }
            };
            transaction.oncomplete = () => resolve(isCurrent());
            transaction.onabort = () => {
                if (!isCurrent()) {
                    resolve(false);
                    return;
                }
                reject(transaction.error ?? new Error('Local library asset binding was not committed'));
            };
        });
    } finally {
        database.close();
    }
}

async function findBinding(hash: string, isCurrent: () => boolean): Promise<LibraryAssetBinding | null> {
    if (!/^sha256:[a-f0-9]{64}$/.test(hash) || !isCurrent()) {
        return null;
    }
    const database = await openDatabase();
    try {
        if (!isCurrent()) {
            return null;
        }
        const identity = await getLocalPeerSettingsId(database, isCurrent);
        if (!identity || !isCurrent()) {
            return null;
        }
        return await new Promise<LibraryAssetBinding | null>((resolve, reject) => {
            const transaction = database.transaction(MAPPINGS, 'readonly');
            const request = transaction.objectStore(MAPPINGS).get([identity, hash]);
            transaction.oncomplete = () => {
                const row: unknown = request.result;
                if (!isCurrent() || !isBinding(row) || row.localPeerSettingsId !== identity || row.hash !== hash) {
                    resolve(null);
                    return;
                }
                resolve({
                    hash,
                    sampleId: row.sampleId,
                    libraryRootId: row.libraryRootId,
                    relativePath: row.relativePath,
                });
            };
            transaction.onabort = () =>
                reject(transaction.error ?? new Error('Local library asset binding read failed'));
        });
    } finally {
        database.close();
    }
}

/** Local lookup hints never carry project ownership or shared filesystem authority. */
export function createLibraryAssetMappings() {
    return {
        remember: rememberBinding,
        find: findBinding,
    };
}
