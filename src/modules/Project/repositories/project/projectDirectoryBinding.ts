const DATABASE = 'sourdaw-project-directory-bindings';
const STORE = 'directories';

const cachedRoots = new Map<string, FileSystemDirectoryHandle>();
const invalidatedProjectIds = new Set<string>();
const rootCacheGenerations = new Map<string, number>();

function advanceRootCacheGeneration(projectId: string): void {
    rootCacheGenerations.set(projectId, (rootCacheGenerations.get(projectId) ?? 0) + 1);
}

export type ProjectDirectoryBinding = {
    projectId: string;
    recentKey: string;
    root: FileSystemDirectoryHandle;
};

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onerror = () => reject(request.error ?? new Error('Project directory bindings could not be opened'));
        request.onblocked = () => reject(new Error('Project directory bindings upgrade was blocked'));
        request.onsuccess = () => {
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };
    });
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
    return (
        typeof value === 'object' &&
        value !== null &&
        'kind' in value &&
        value.kind === 'directory' &&
        'getDirectoryHandle' in value &&
        typeof value.getDirectoryHandle === 'function' &&
        'queryPermission' in value &&
        typeof value.queryPermission === 'function'
    );
}

/** The binding is private browser state, never part of the shared project document. */
async function loadProjectDirectoryRoot(projectId: string): Promise<FileSystemDirectoryHandle | null> {
    if (invalidatedProjectIds.has(projectId)) {
        return null;
    }
    const cached = cachedRoots.get(projectId);
    if (cached) {
        return cached;
    }
    if (!globalThis.indexedDB) {
        throw new Error('Project directory bindings are unavailable');
    }
    const generation = rootCacheGenerations.get(projectId);
    const database = await openDatabase();
    try {
        const value = await new Promise<unknown>((resolve, reject) => {
            const transaction = database.transaction(STORE, 'readonly');
            const request = transaction.objectStore(STORE).get(projectId);
            transaction.oncomplete = () => resolve(request.result);
            transaction.onabort = () => reject(transaction.error ?? new Error('Project directory binding read failed'));
        });
        // A folder selected or cleared during this read owns the live cache,
        // even when this earlier readonly transaction still sees the old root.
        if (rootCacheGenerations.get(projectId) !== generation) {
            return cachedProjectDirectoryRoot(projectId);
        }
        if (value === undefined) {
            return null;
        }
        if (!isDirectoryHandle(value)) {
            throw new Error('Project directory binding is invalid');
        }
        cachedRoots.set(projectId, value);
        return value;
    } finally {
        database.close();
    }
}

async function loadProjectDirectoryBinding(key: string): Promise<ProjectDirectoryBinding | null> {
    if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') {
        return null;
    }
    const database = await openDatabase();
    try {
        const value = await new Promise<unknown>((resolve, reject) => {
            const transaction = database.transaction(STORE, 'readonly');
            const request = transaction.objectStore(STORE).get(key);
            transaction.oncomplete = () => resolve(request.result);
            transaction.onabort = () => reject(transaction.error ?? new Error('Project directory binding read failed'));
        });
        if (value === undefined) {
            return null;
        }
        if (
            typeof value !== 'object' ||
            value === null ||
            !('projectId' in value) ||
            typeof value.projectId !== 'string' ||
            !('recentKey' in value) ||
            typeof value.recentKey !== 'string' ||
            !('root' in value) ||
            !isDirectoryHandle(value.root)
        ) {
            throw new Error('Project directory binding is invalid');
        }
        if (key === 'last' && invalidatedProjectIds.has(value.projectId)) {
            return null;
        }
        return { projectId: value.projectId, recentKey: value.recentKey, root: value.root };
    } finally {
        database.close();
    }
}

async function clearLastProjectDirectoryBinding(projectId?: string): Promise<void> {
    if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') {
        return;
    }
    if (projectId) {
        advanceRootCacheGeneration(projectId);
        cachedRoots.delete(projectId);
        invalidatedProjectIds.add(projectId);
    }
    const database = await openDatabase();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(STORE, 'readwrite');
            transaction.objectStore(STORE).delete('last');
            if (projectId) {
                transaction.objectStore(STORE).delete(projectId);
            }
            transaction.oncomplete = () => resolve();
            transaction.onabort = () =>
                reject(transaction.error ?? new Error('Last project directory binding could not be cleared'));
        });
    } finally {
        database.close();
    }
}

function cachedProjectDirectoryRoot(projectId: string): FileSystemDirectoryHandle | null {
    return invalidatedProjectIds.has(projectId) ? null : (cachedRoots.get(projectId) ?? null);
}

async function bindProjectDirectoryRoot(
    projectId: string,
    root: FileSystemDirectoryHandle,
    recentKey: string
): Promise<void> {
    if (!isDirectoryHandle(root)) {
        throw new Error('Selected project directory is invalid');
    }
    // The selected folder already owns the committed project at this point.
    // A failed private bookmark write must never send the next Save to an older
    // folder with the same project id in this live session.
    advanceRootCacheGeneration(projectId);
    cachedRoots.set(projectId, root);
    invalidatedProjectIds.add(projectId);
    const database = await openDatabase();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(STORE, 'readwrite');
            transaction.objectStore(STORE).put(root, projectId);
            const binding: ProjectDirectoryBinding = { projectId, recentKey, root };
            transaction.objectStore(STORE).put(binding, `recent:${recentKey}`);
            transaction.objectStore(STORE).put(binding, 'last');
            transaction.oncomplete = () => resolve();
            transaction.onabort = () =>
                reject(transaction.error ?? new Error('Project directory binding write failed'));
        });
        invalidatedProjectIds.delete(projectId);
    } finally {
        database.close();
    }
}

/** Call during a user gesture, before Save's first await. */
function beginProjectDirectorySelection(): Promise<FileSystemDirectoryHandle> {
    if (!('showDirectoryPicker' in window)) {
        throw new Error('Project folder selection is unavailable');
    }
    return window.showDirectoryPicker({ mode: 'readwrite' });
}

async function openProjectDirectory(
    root: FileSystemDirectoryHandle,
    projectId: string,
    create: boolean
): Promise<FileSystemDirectoryHandle> {
    if ((await root.queryPermission({ mode: create ? 'readwrite' : 'read' })) !== 'granted') {
        throw new Error('Project folder permission is unavailable');
    }
    if (root.name === projectId) {
        return root;
    }
    const projects = await root.getDirectoryHandle('projects', { create });
    return projects.getDirectoryHandle(projectId, { create });
}

export const projectDirectoryBinding = {
    loadProjectDirectoryRoot,
    loadProjectDirectoryBinding,
    clearLastProjectDirectoryBinding,
    cachedProjectDirectoryRoot,
    bindProjectDirectoryRoot,
    beginProjectDirectorySelection,
    openProjectDirectory,
};
