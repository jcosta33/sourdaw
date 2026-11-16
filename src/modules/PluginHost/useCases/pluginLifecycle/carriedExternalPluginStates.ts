/**
 * Live plugin state read just before an app-initiated teardown destroyed its
 * native instance, keyed by that instance id, waiting for the same instance to
 * be activated again.
 *
 * Runtime state, never project truth: the project's `externalStateChunk` only
 * changes through Save/Export capture or an explicit replacement. An entry is
 * consumed once by the next activation of the same instance id and plugin, and
 * the whole store is dropped once the project it belonged to is really replaced
 * or its session really ends; a whole-runtime unload that can still be undone
 * (a refusable project switch, a cancellable session retirement) keeps it.
 */
export type CarriedExternalPluginState = { pluginId: string; stateChunk: string };

export const carriedExternalPluginStates = new Map<string, CarriedExternalPluginState>();

let carryGeneration = 0;

const slotVersions = new Map<string, number>();

/**
 * Fences over the carry store. A teardown read batch remembers the generation
 * it started in, so a commit landing after a drop is discarded instead of
 * carrying the outgoing project's state into the incoming one.
 *
 * Each read also remembers its instance's slot version. A teardown commit
 * writing a carry, an activation taking one and a rejected carried restore
 * dropping one each advance it, so a read that one of those overtook — an
 * engine retire holding its batch across the retire, while the same persisted
 * instance id is removed or reactivated — cannot overwrite a newer carry,
 * plant one on the reactivated instance, or revive a rejected one.
 */
export const carriedExternalPluginStateFence = {
    generation(): number {
        return carryGeneration;
    },
    slotVersion(instanceId: string): number {
        return slotVersions.get(instanceId) ?? 0;
    },
    advanceSlot(instanceId: string): void {
        slotVersions.set(instanceId, (slotVersions.get(instanceId) ?? 0) + 1);
    },
    dropAll(): void {
        carriedExternalPluginStates.clear();
        slotVersions.clear();
        carryGeneration += 1;
    },
};
