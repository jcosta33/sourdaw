import { DEFAULT_CRDT_ROOT_LINEAGE, parseCrdtRootLineage } from '../../models/CrdtRootLineage';

import {
    EMPTY_PERSISTENCE_AUTHORITY,
    LEGACY_PERSISTENCE_AUTHORITY_VERSION,
    PERSISTENCE_AUTHORITY_VERSION,
    type CrdtPersistenceAuthority,
} from './persistenceAuthorityModel';
import { toPersistenceBytes } from './toPersistenceBytes';

type UnknownRecord = {
    [key: string]: unknown;
};

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
