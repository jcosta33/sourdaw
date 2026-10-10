import { type Track } from '#/modules/Arrangement/stores';

/** Committed-project access supplied by the composition root; this port stores no project data. */
export type InputMonitoringProjectAccess = {
    captureRootIdentity: () => string;
    hasTrack: (trackId: string) => boolean;
    readTrack: (trackId: string) => Pick<Track, 'inputMonitoring' | 'inputId' | 'kind' | 'armed'> | null;
    subscribe: (listener: () => void) => () => void;
};

let provider: InputMonitoringProjectAccess | null = null;

export function setInputMonitoringProjectAccess(next: InputMonitoringProjectAccess | null): void {
    provider = next;
}

/** Capture the current runtime root, or the isolated-runtime sentinel when no provider exists. */
export function captureInputMonitoringProjectRootIdentity(): string | null {
    return provider?.captureRootIdentity() ?? null;
}

/** An isolated runtime without a provider has no committed owner to veto teardown. */
export function hasCommittedInputMonitoringTrack(trackId: string): boolean {
    return provider?.hasTrack(trackId) ?? false;
}

/** Read current committed intent, never an optimistic store projection. */
export function readCommittedInputMonitoringTrack(
    trackId: string
): ReturnType<InputMonitoringProjectAccess['readTrack']> {
    return provider?.readTrack(trackId) ?? null;
}

export function subscribeToInputMonitoringProjectChanges(listener: () => void): () => void {
    return provider?.subscribe(listener) ?? (() => undefined);
}
