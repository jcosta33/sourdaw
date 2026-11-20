/**
 * Keyed unloads admitted but not yet settled, by instance id. An activation of an instance that is
 * still loaded only because its unload has not reached the native host waits here, so it reloads
 * after the teardown instead of answering active for an instance about to be forgotten.
 */
const pending = new Map<string, Promise<void>>();

function forgetSettled(instanceId: string, unload: Promise<void>): void {
    if (pending.get(instanceId) === unload) {
        pending.delete(instanceId);
    }
}

export const pendingKeyedUnloads = {
    track(instanceId: string, unload: Promise<void>): void {
        pending.set(instanceId, unload);
        unload.then(
            () => forgetSettled(instanceId, unload),
            () => forgetSettled(instanceId, unload)
        );
    },

    get(instanceId: string): Promise<void> | undefined {
        return pending.get(instanceId);
    },
};
