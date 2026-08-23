import { PeerConnectionManager } from '../../repositories/peerConnection';
import { AssetTransfer } from '../assetTransfer';

import { collaborationAssetOwnership } from './getCollaborationAssetOwnerId';
import { sessionRuntimePrimitives as runtime } from './sessionManagement';

let projectTransfer: { ownerId: string; transfer: AssetTransfer } | null = null;

function createProjectAssetTransfer(ownerId: string): AssetTransfer {
    const peerManager = new PeerConnectionManager({
        onMessage: () => undefined,
        onConnected: () => undefined,
        onDisconnected: () => undefined,
    });
    return new AssetTransfer(
        peerManager,
        {
            onAssetAvailable: () => undefined,
            onProgress: () => undefined,
            onTransferFailed: () => undefined,
        },
        ownerId
    );
}

/** Return session transport when present, otherwise the active project's durable asset runtime. */
export function getAssetTransfer(): AssetTransfer | null {
    if (runtime.state.assetTransfer) {
        projectTransfer?.transfer.dispose();
        projectTransfer = null;
        return runtime.state.assetTransfer;
    }
    const ownerId = collaborationAssetOwnership.getOwnerId();
    if (projectTransfer?.ownerId !== ownerId) {
        projectTransfer?.transfer.dispose();
        projectTransfer = { ownerId, transfer: createProjectAssetTransfer(ownerId) };
    }
    return projectTransfer.transfer;
}
