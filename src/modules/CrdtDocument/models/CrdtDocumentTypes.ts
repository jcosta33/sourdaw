/** Unique identifier for an Automerge document in the multi-document model. */
export type DocId = string;

/** A bundle of serialized Automerge documents keyed by DocId. */
export type DocumentBundle = Map<DocId, Uint8Array>;

/** Summary of a merge operation. */
export type MergeResult = {
    mergedDocIds: DocId[];
    newDocIds: DocId[];
};

/** Document ID for the root project document. */
export const DOC_PREFIX_ROOT = 'root';
