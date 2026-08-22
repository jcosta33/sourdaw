type CollaborationAssetOwnershipProvider = {
    captureOwnerId: () => string | undefined;
};

let provider: CollaborationAssetOwnershipProvider | null = null;

export function configureCollaborationAssetOwner(nextProvider: CollaborationAssetOwnershipProvider): void {
    provider = nextProvider;
}

export const collaborationAssetOwnership = {
    /** Capture the active project's opaque durable-asset owner identity. */
    getOwnerId(): string {
        const ownerId = provider?.captureOwnerId();
        if (!ownerId) {
            throw new Error('The active project has no durable asset owner identity');
        }
        return ownerId;
    },
};
