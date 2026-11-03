/**
 * Where project persistence keeps the source audio the project owns.
 *
 * Collaboration owns the durable original-asset store and the session that authorizes it, and
 * Project is a core aggregate that a supporting module may not be imported from. The composition
 * root therefore fills this port from Collaboration's contract surface; Project code never imports
 * Collaboration. With no port configured there is no owner to read, so every operation refuses
 * instead of pretending the originals are gone.
 */

export type CapturedProjectOriginals = {
    media: Map<string, Blob>;
    unavailable: string[];
};

export type ProjectOriginalMediaPort = {
    /** Resolve only verified project-owned originals for the hashes a saved snapshot references. */
    capture(projectId: string, hashes: readonly string[], shouldContinue: () => boolean): Promise<CapturedProjectOriginals>;
    /** Restore verified original bytes under their project identity before the project is visible. */
    restore(projectId: string, media: ReadonlyMap<string, Uint8Array>, shouldContinue: () => boolean): Promise<void>;
    /** Suppress peer requests for every original just restored from a local project. */
    activate(projectId: string, hashes: readonly string[], shouldContinue: () => boolean): Promise<void>;
};

let port: ProjectOriginalMediaPort | null = null;

function requirePort(): ProjectOriginalMediaPort {
    if (port === null) {
        throw new Error('Project original media is unavailable');
    }
    return port;
}

export const projectOriginalMediaPort = {
    capture(projectId: string, hashes: readonly string[], shouldContinue: () => boolean) {
        return requirePort().capture(projectId, hashes, shouldContinue);
    },
    restore(projectId: string, media: ReadonlyMap<string, Uint8Array>, shouldContinue: () => boolean) {
        return requirePort().restore(projectId, media, shouldContinue);
    },
    activate(projectId: string, hashes: readonly string[], shouldContinue: () => boolean) {
        return requirePort().activate(projectId, hashes, shouldContinue);
    },
    /** The composition root registers Collaboration's contract surface here. */
    configure(next: ProjectOriginalMediaPort | null): void {
        port = next;
    },
};
