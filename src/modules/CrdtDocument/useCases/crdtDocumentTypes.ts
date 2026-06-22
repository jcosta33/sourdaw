/**
 * Re-export of the canonical CRDT document type module.
 *
 * The single source of truth lives in `../models/CrdtDocumentTypes` (types
 * belong in `models/`, and the `repositories/` layer can import from there but
 * not from `useCases/`). This barrel keeps the historical `useCases/`-relative
 * import path working for use-case files and external callers without
 * duplicating the definitions — change the types in one place.
 */
export * from '../models/CrdtDocumentTypes';
