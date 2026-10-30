type UnchangedCompletion = { readonly status: 'unchanged'; readonly revision: number };
type ActiveDetection = { controller: AbortController; completion?: UnchangedCompletion };
const active = new Map<string, ActiveDetection>();
const revisions = new Map<string, number>();

function revision(clipId: string): number {
    return revisions.get(clipId) ?? 0;
}

export const transientDetectionLifecycle = Object.freeze({
    revision,
    cancel(clipId: string): void {
        active.get(clipId)?.controller.abort();
        active.delete(clipId);
        revisions.set(clipId, revision(clipId) + 1);
    },
    activate(clipId: string, controller: AbortController): void {
        active.set(clipId, { controller });
    },
    owns(clipId: string, controller: AbortController): boolean {
        return active.get(clipId)?.controller === controller;
    },
    completeUnchanged(clipId: string, controller: AbortController): boolean {
        const owner = active.get(clipId);
        if (owner?.controller !== controller || controller.signal.aborted) {
            return false;
        }
        owner.completion = { status: 'unchanged', revision: revision(clipId) };
        return true;
    },
    readCompletion(clipId: string, expectedRevision: number): UnchangedCompletion | undefined {
        const owner = active.get(clipId);
        if (
            owner?.controller.signal.aborted ||
            revision(clipId) !== expectedRevision ||
            owner?.completion?.revision !== expectedRevision
        ) {
            return undefined;
        }
        return owner?.completion;
    },
});
