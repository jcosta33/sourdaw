export type CheckpointCatalogEntry = {
    checkpointId: string;
    ownerProjectId: string;
    label: string;
    description: string;
    tags: string[];
    createdAt: string;
    parentId: string | null;
    audioBufferIds: string[];
    ownershipToken: string;
};

export type CheckpointArtifactRecord = CheckpointCatalogEntry & {
    rootBytes: Uint8Array;
};
