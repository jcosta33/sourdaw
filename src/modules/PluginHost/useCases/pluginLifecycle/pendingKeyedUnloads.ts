/**
 * Keyed unloads admitted but not yet settled, by instance id. An activation of an instance that is
 * still loaded only because its unload has not reached the native host waits here, so it reloads
 * after the teardown instead of answering active for an instance about to be forgotten. Each
 * admitted unload advances the instance's generation, so a waiting activation can tell that a later
 * unload was requested while it waited and must not reload.
 */
const pending = new Map<string, Promise<void>>();
const generations = new Map<string, number>();

function forgetSettled(instanceId: string, unload: Promise<void>): void {
    if (pending.get(instanceId) === unload) {
        pending.delete(instanceId);
    }
}

export const pendingKeyedUnloads = {
    track(instanceId: string, unload: Promise<void>): void {
        pending.set(instanceId, unload);
        generations.set(instanceId, (generations.get(instanceId) ?? 0) + 1);
        unload.then(
            () => forgetSettled(instanceId, unload),
            () => forgetSettled(instanceId, unload)
        );
    },

    get(instanceId: string): Promise<void> | undefined {
        return pending.get(instanceId);
    },

    generation(instanceId: string): number {
        return generations.get(instanceId) ?? 0;
    },
};
