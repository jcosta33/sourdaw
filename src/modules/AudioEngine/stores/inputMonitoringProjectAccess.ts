/** Committed-project access supplied by the composition root; this port stores no project data. */
export type InputMonitoringProjectAccess = {
    hasTrack: (trackId: string) => boolean;
    subscribe: (listener: () => void) => () => void;
};

let provider: InputMonitoringProjectAccess | null = null;

export function setInputMonitoringProjectAccess(next: InputMonitoringProjectAccess | null): void {
    provider = next;
}

/** An isolated runtime without a provider has no committed owner to veto teardown. */
export function hasCommittedInputMonitoringTrack(trackId: string): boolean {
    return provider?.hasTrack(trackId) ?? false;
}

export function subscribeToInputMonitoringProjectChanges(listener: () => void): () => void {
    return provider?.subscribe(listener) ?? (() => undefined);
}
