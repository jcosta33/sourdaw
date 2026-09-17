/**
 * Agent-facing vocabulary for catalog search over the indexed sample library.
 *
 * An agent supplies a query and never an entry: every candidate here is built
 * from a record that already exists in the library store, and carries the
 * provenance, licensing, and matching evidence that let a caller check the
 * answer against the index rather than trust it.
 */

import { type FileProviderKind, type SampleSyncStatus, type SpectralDescriptors } from './LibraryTypes';

/** Schema name every catalog answer carries, so a consumer can route on it. */
export const AGENT_CATALOG_SEARCH_SCHEMA = 'sourdaw.agent-catalog-search';

/** Schema revision; a consumer reads it before trusting the payload shape. */
export const AGENT_CATALOG_SEARCH_SCHEMA_VERSION = 1 as const;

/** Entries returned when the caller names no limit. */
export const AGENT_CATALOG_DEFAULT_LIMIT = 8;

/**
 * Hard ceiling on one answer, and on the similarity ranking it draws from.
 * The bound keeps an agent-visible payload small enough to stay inside a model
 * context window whatever the library holds.
 */
export const AGENT_CATALOG_MAX_LIMIT = 24;

/**
 * Where a candidate came from. `origin` is derived from the library root the
 * record belongs to, never from anything the agent supplied.
 */
export type AgentCatalogProvenance = {
    readonly origin: 'factory' | 'connected-library';
    readonly libraryRootId: string;
    readonly libraryRootName: string;
    readonly provider: FileProviderKind;
    readonly relativePath: string;
    readonly indexStatus: SampleSyncStatus;
};

/**
 * What a caller may do with a candidate's audio. Derived from the origin: the
 * factory content ships with Sourdaw, everything else is the user's own library
 * under whatever terms they hold it.
 */
export type AgentCatalogLicensing =
    | { readonly source: 'factory'; readonly rightsHolder: 'sourdaw'; readonly terms: 'bundled-with-sourdaw' }
    | { readonly source: 'user-library'; readonly rightsHolder: 'user'; readonly terms: 'as-licensed-to-the-user' };

/**
 * Descriptors copied from the record. A measurable figure the record does not
 * carry is `null`; it is never a guessed or interpolated number.
 */
export type AgentCatalogDescriptors = {
    readonly textual: {
        readonly displayName: string;
        readonly folder: string;
        readonly ext: string;
        readonly tags: readonly string[];
    };
    readonly measurable: {
        readonly durationSec: number | null;
        readonly sampleRate: number | null;
        readonly channels: number | null;
        readonly bpm: number | null;
        readonly key: string | null;
        readonly spectral: SpectralDescriptors | null;
    };
};

/** Why a candidate is in the answer: the field that matched, or its similarity rank. */
export type AgentCatalogEvidence =
    | { readonly kind: 'name' | 'path' | 'tag'; readonly term: string; readonly matched: string }
    | { readonly kind: 'similar-to'; readonly anchorId: string; readonly rank: number };

export type AgentCatalogCandidate = {
    readonly id: string;
    readonly kind: 'sample';
    readonly displayName: string;
    readonly provenance: AgentCatalogProvenance;
    readonly licensing: AgentCatalogLicensing;
    readonly descriptors: AgentCatalogDescriptors;
    readonly evidence: readonly AgentCatalogEvidence[];
    readonly score: number;
};

export type AgentCatalogSearchInput = {
    text?: string;
    similarTo?: string;
    limit?: number;
};

export type AgentCatalogSearchResult =
    | {
          status: 'results';
          schema: typeof AGENT_CATALOG_SEARCH_SCHEMA;
          schemaVersion: typeof AGENT_CATALOG_SEARCH_SCHEMA_VERSION;
          query: { text: string | null; similarTo: string | null; limit: number };
          items: readonly AgentCatalogCandidate[];
          total: number;
          truncated: boolean;
          warnings: readonly string[];
      }
    | { status: 'rejected'; reason: 'empty-query' | 'unknown-catalog-id' | 'limit-out-of-range' };
