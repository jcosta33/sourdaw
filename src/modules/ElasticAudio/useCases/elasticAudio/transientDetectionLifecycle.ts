const active = new Map<string, AbortController>();
const revisions = new Map<string, number>();

function revision(clipId: string): number {
    return revisions.get(clipId) ?? 0;
}

export const transientDetectionLifecycle = Object.freeze({
    revision,
    cancel(clipId: string): void {
        active.get(clipId)?.abort();
        active.delete(clipId);
        revisions.set(clipId, revision(clipId) + 1);
    },
    activate(clipId: string, controller: AbortController): void {
        active.set(clipId, controller);
    },
    owns(clipId: string, controller: AbortController): boolean {
        return active.get(clipId) === controller;
    },
});
