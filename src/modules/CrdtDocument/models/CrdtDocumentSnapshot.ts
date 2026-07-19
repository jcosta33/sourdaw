import { type DocId } from './CrdtDocumentTypes';

export type CrdtDocumentSnapshotEntry =
    | {
          readonly state: 'present';
          readonly bytes: Uint8Array;
          readonly expectedCurrent?: CrdtDocumentSnapshotExpectedState;
      }
    | { readonly state: 'absent'; readonly expectedCurrent?: CrdtDocumentSnapshotExpectedState };

export type CrdtDocumentSnapshotExpectedState =
    | { readonly state: 'present'; readonly heads: readonly string[] }
    | { readonly state: 'absent' };

/** Exact pre/post state for the documents owned by one snapshot transaction. */
export type CrdtDocumentSnapshot = Map<DocId, CrdtDocumentSnapshotEntry>;
