import { DEFAULT_CRDT_ROOT_LINEAGE } from '../../models/CrdtRootLineage';

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

export const LEGACY_PERSISTENCE_AUTHORITY_VERSION = 1;
export const PERSISTENCE_AUTHORITY_VERSION = 2;
