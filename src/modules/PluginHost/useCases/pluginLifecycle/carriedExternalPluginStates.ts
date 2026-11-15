/**
 * Live plugin state read just before an app-initiated teardown destroyed its
 * native instance, keyed by that instance id, waiting for the same instance to
 * be activated again.
 *
 * Runtime state, never project truth: the project's `externalStateChunk` only
 * changes through Save/Export capture or an explicit replacement. An entry is
 * consumed once by the next activation of the same instance id and plugin, and
 * the whole store is dropped by every whole-runtime unload, because the project
 * it belonged to is being replaced or retired.
 */
export const carriedExternalPluginStates = new Map<string, { pluginId: string; stateChunk: string }>();

let carryGeneration = 0;

/**
 * Generation fence over the carry store. A teardown read batch remembers the
 * generation it started in, so a commit landing after a drop is discarded
 * instead of carrying the outgoing project's state into the incoming one.
 */
export const carriedExternalPluginStateFence = {
    generation(): number {
        return carryGeneration;
    },
    dropAll(): void {
        carriedExternalPluginStates.clear();
        carryGeneration += 1;
    },
};
