import { startAssetBitmapLifecycle } from '../assetBitmapLifecycle';

type CollaborationAssetOwnershipProvider = {
    captureOwnerId: () => string | undefined;
};

let provider: CollaborationAssetOwnershipProvider | null = null;
let stopBitmapLifecycle: (() => void) | undefined;

export function configureCollaborationAssetOwner(nextProvider: CollaborationAssetOwnershipProvider): void {
    stopBitmapLifecycle?.();
    provider = nextProvider;
    stopBitmapLifecycle = startAssetBitmapLifecycle();
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
