export const ASSET_RESUME_DATABASE = 'sourdaw-collaboration-partial-assets';
export const ASSET_RESUME_METADATA = 'transfers';
export const ASSET_RESUME_CHUNKS = 'chunks';
export const ASSET_RESUME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const ASSET_CHUNK_INTEGRITY_VERSION = 1;

export type ResumeManifest = {
    hash: string;
    size: number;
    chunkSize: number;
    chunkCount: number;
    name: string;
    mime: string;
};

export type ResumeMetadata = {
    schemaVersion: 1;
    ownerId: string;
    hash: string;
    generation: string;
    writerId: string;
    revision: number;
    manifest: ResumeManifest;
    received: number[];
    lastVerifiedProgressAt: number;
};

export type ResumeChunk = {
    ownerId: string;
    hash: string;
    generation: string;
    index: number;
    data: Uint8Array;
    digest: string;
};

export type ResumeJournal = {
    metadata: ResumeMetadata;
    chunks: ResumeChunk[];
};

export type ResumeAuthority = {
    signal: AbortSignal;
    isCurrent: () => boolean;
};
