import { DEFAULT_CRDT_ROOT_LINEAGE, parseCrdtRootLineage } from '../../models/CrdtRootLineage';

export type CrdtPersistenceAuthority = {
    readonly epoch: string;
    readonly revision: number;
    readonly rootLineage: string;
};

export const PERSISTENCE_AUTHORITY_KEY = '__sourdaw_crdt_persistence_authority__';

export const EMPTY_PERSISTENCE_AUTHORITY: CrdtPersistenceAuthority = {
    epoch: '',
    revision: 0,
    rootLineage: DEFAULT_CRDT_ROOT_LINEAGE,
};

const LEGACY_PERSISTENCE_AUTHORITY_VERSION = 1;
const PERSISTENCE_AUTHORITY_VERSION = 2;

function isPersistenceUint8Array(value: unknown): value is Uint8Array {
    return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';
}

/** Normalize typed-array values returned by an IndexedDB realm boundary. */
export function toPersistenceBytes(value: unknown): Uint8Array | null {
    if (!isPersistenceUint8Array(value)) {
        return null;
    }

    return Uint8Array.from(value);
}

type UnknownRecord = {
    [key: string]: unknown;
};

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function encodePersistenceAuthority(authority: CrdtPersistenceAuthority): Uint8Array {
    const rootLineage = parseCrdtRootLineage(authority.rootLineage);
    if (!rootLineage) {
        throw new TypeError('[CrdtPersistence] Invalid root lineage');
    }

    return new TextEncoder().encode(
        JSON.stringify({
            version: PERSISTENCE_AUTHORITY_VERSION,
            epoch: authority.epoch,
            revision: authority.revision,
            rootLineage,
        })
    );
}

export function decodePersistenceAuthority(value: unknown): CrdtPersistenceAuthority {
    const bytes = toPersistenceBytes(value);
    if (!bytes) {
        return EMPTY_PERSISTENCE_AUTHORITY;
    }

    try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!isRecord(parsed)) {
            return EMPTY_PERSISTENCE_AUTHORITY;
        }

        const revision = parsed.revision;
        if (
            typeof parsed.epoch !== 'string' ||
            typeof revision !== 'number' ||
            !Number.isSafeInteger(revision) ||
            revision < 0
        ) {
            return EMPTY_PERSISTENCE_AUTHORITY;
        }

        if (parsed.version === LEGACY_PERSISTENCE_AUTHORITY_VERSION) {
            return {
                epoch: parsed.epoch,
                revision,
                rootLineage: DEFAULT_CRDT_ROOT_LINEAGE,
            };
        }

        const rootLineage = parseCrdtRootLineage(parsed.rootLineage);
        if (parsed.version !== PERSISTENCE_AUTHORITY_VERSION || !rootLineage) {
            return EMPTY_PERSISTENCE_AUTHORITY;
        }

        return {
            epoch: parsed.epoch,
            revision,
            rootLineage,
        };
    } catch {
        return EMPTY_PERSISTENCE_AUTHORITY;
    }
}

export function arePersistenceAuthoritiesEqual(
    left: CrdtPersistenceAuthority,
    right: CrdtPersistenceAuthority
): boolean {
    return left.epoch === right.epoch && left.revision === right.revision && left.rootLineage === right.rootLineage;
}

export function advancePersistenceAuthority(
    current: CrdtPersistenceAuthority,
    epoch = current.epoch,
    rootLineage = current.rootLineage
): CrdtPersistenceAuthority {
    if (current.revision >= Number.MAX_SAFE_INTEGER) {
        throw new Error('[CrdtPersistence] Persistence revision exhausted');
    }

    const validatedRootLineage = parseCrdtRootLineage(rootLineage);
    if (!validatedRootLineage) {
        throw new TypeError('[CrdtPersistence] Invalid root lineage');
    }

    return {
        epoch,
        revision: current.revision + 1,
        rootLineage: validatedRootLineage,
    };
}
