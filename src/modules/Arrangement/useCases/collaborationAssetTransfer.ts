/** The verdict a durable promotion of a staged asset ends with. */
type DurableAssetPromotion = { status: 'promoted' | 'already-promoted' } | { status: 'failed'; reason: string };

/**
 * The asset runtime an import stages its audio with and live playback asks
 * for a missing clip's bytes through, so a peer receives the clip with the
 * bytes it needs.
 */
type CollaborationAssetHandle = {
    stageLocalAsset: (blob: Blob, name: string) => Promise<{ hash: string; leaseId: string }>;
    promoteStagedAsset: (leaseId: string) => boolean;
    releaseStagedAsset: (leaseId: string) => void;
    promoteDurableStagedAsset: (leaseId: string, expectedHash: string) => Promise<DurableAssetPromotion>;
    requestAsset: (hash: string) => void;
};

type CollaborationAssetTransfer = {
    /**
     * The session's asset transport when a session is on, otherwise the
     * active project's durable asset runtime; `null` when neither answers.
     */
    current: () => CollaborationAssetHandle | null;
    /** Whether a collaboration session is on, so a missing clip's bytes can come from a peer. */
    isSessionActive: () => boolean;
};

let registeredTransfer: CollaborationAssetTransfer | null = null;

/**
 * Arrangement and Transport may not import Collaboration, which orbits them,
 * so the composition root (`#/app/registerSupportingServicePorts`) fills this
 * once at boot, before anything can import audio or start playback.
 */
export const collaborationAssetTransfer = {
    /**
     * Registering the identical transfer again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(transfer: CollaborationAssetTransfer): void {
        if (registeredTransfer === null) {
            registeredTransfer = transfer;
            return;
        }
        if (
            registeredTransfer.current !== transfer.current ||
            registeredTransfer.isSessionActive !== transfer.isSessionActive
        ) {
            throw new Error('collaborationAssetTransfer.configure: the transfer differs from the registered one');
        }
    },
    /**
     * The registered transfer. Reading before registration throws rather than
     * answering no runtime: an import would then publish clips no peer can
     * fetch, and playback would never ask a peer for missing audio.
     */
    read(caller: string): CollaborationAssetTransfer {
        if (registeredTransfer === null) {
            throw new Error(
                `${caller}: the collaboration asset transfer is not registered; call registerSupportingServicePorts() from #/app/registerSupportingServicePorts (bootstrap does this)`
            );
        }
        return registeredTransfer;
    },
};
