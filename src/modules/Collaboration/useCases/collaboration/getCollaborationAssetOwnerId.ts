let captureOwnerId: (() => string | undefined) | null = null;

export function configureCollaborationAssetOwner(provider: () => string | undefined): void {
    captureOwnerId = provider;
}

/** Capture the active project's opaque durable-asset owner identity. */
export function getCollaborationAssetOwnerId(): string {
    const ownerId = captureOwnerId?.();
    if (!ownerId) {
        throw new Error('The active project has no durable asset owner identity');
    }
    return ownerId;
}
