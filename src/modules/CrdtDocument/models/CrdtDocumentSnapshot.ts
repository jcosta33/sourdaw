import { type DocId } from './CrdtDocumentTypes';

export type CrdtDocumentSnapshotEntry =
    | { readonly state: 'present'; readonly bytes: Uint8Array }
    | { readonly state: 'absent' };

/** Exact pre/post state for the documents owned by one snapshot transaction. */
export type CrdtDocumentSnapshot = Map<DocId, CrdtDocumentSnapshotEntry>;
