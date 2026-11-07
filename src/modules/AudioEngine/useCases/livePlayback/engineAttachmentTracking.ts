/**
 * The record of built-in instrument instances the native engine reports it
 * holds, keyed by device id. The instrument's module owns the record; the
 * live graph writes what the engine reports into it and reads it back when
 * it decides which devices the engine already hosts.
 */
type EngineAttachmentTracking = {
    /** Record that the engine reported holding the instance. */
    markAttached: (instanceId: string) => void;
    /** Every instance the engine is recorded as holding. */
    readAttachedInstanceIds: () => ReadonlySet<string>;
    /** Forget every recorded attachment, as when the runtime graph is rebuilt. */
    retractEveryAttachment: () => void;
};

let registeredTracking: EngineAttachmentTracking | null = null;

function trackingDiffers(current: EngineAttachmentTracking, next: EngineAttachmentTracking): boolean {
    return (
        current.markAttached !== next.markAttached ||
        current.readAttachedInstanceIds !== next.readAttachedInstanceIds ||
        current.retractEveryAttachment !== next.retractEveryAttachment
    );
}

/**
 * AudioEngine and Transport may not import a device module, so the
 * composition root (`#/app/registerDeviceEnginePorts`) fills this once at
 * boot, before anything can apply a graph batch.
 */
export const engineAttachmentTracking = {
    /**
     * Registering the identical tracking again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(tracking: EngineAttachmentTracking): void {
        if (registeredTracking === null) {
            registeredTracking = tracking;
            return;
        }
        if (trackingDiffers(registeredTracking, tracking)) {
            throw new Error('engineAttachmentTracking.configure: the tracking differs from the registered one');
        }
    },
    /**
     * The registered tracking. Reading before registration throws rather than
     * answering an empty record: one would report every engine-held instance
     * as missing and leave it on the Web Audio fallback.
     */
    read(caller: string): EngineAttachmentTracking {
        if (registeredTracking === null) {
            throw new Error(
                `${caller}: engine attachment tracking is not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredTracking;
    },
};
