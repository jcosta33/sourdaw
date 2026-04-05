/**
 * Public type surface for CrdtDocument's pure-model types and constants.
 *
 * These are pure models per SKILL §6.4: plain data shapes (string alias,
 * Map<string, Uint8Array>, constant strings) with no behavior and no
 * framework coupling. Cross-module consumers may import these directly.
 */
export type { DocId, DocumentBundle, MergeResult } from '../models/CrdtDocumentTypes';
export { DOC_PREFIX_ROOT, DOC_BRANCHES } from '../models/CrdtDocumentTypes';
