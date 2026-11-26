/**
 * The keyed unload each instance id has queued on its lifecycle turn and not
 * yet settled.
 *
 * Activation is not serialized on that turn, so a reactivation of an instance
 * still loaded would answer from the prior outcome and then lose the instance
 * to the queued unload. `activateExternalPlugin` waits on the entry here
 * instead, and activates once the unload has settled. An entry leaves on its
 * own settlement, and only while it is still the latest unload for that id.
 *
 * Ephemeral runtime state, not project truth.
 */
export const pendingKeyedUnloads = new Map<string, Promise<void>>();

/**
 * How many keyed unloads each instance id has had admitted. An activation that
 * waited on one compares it after the wait: a later unload admitted meanwhile
 * (Remove, Undo, Redo) owns the instance's fate, so the waiter must not reload.
 */
export const pendingKeyedUnloadGenerations = new Map<string, number>();

/**
 * The latest keyed-unload generation of each instance id that a rebuild fence
 * let go of (`failUnresponsiveExternalPlugins`). That unload, and every one
 * admitted before it, no longer owns the instance: the id may already belong to
 * a later activation, so a late native answer writes nothing onto it.
 */
export const letGoKeyedUnloadGenerations = new Map<string, number>();

/** The generation of each instance id's keyed unload still pending, as a fence reads them when it begins. */
export function pendingKeyedUnloadAdmissions(): ReadonlyMap<string, number> {
    const admissions = new Map<string, number>();
    for (const instanceId of pendingKeyedUnloads.keys()) {
        const generation = pendingKeyedUnloadGenerations.get(instanceId);
        if (generation !== undefined) {
            admissions.set(instanceId, generation);
        }
    }
    return admissions;
}
