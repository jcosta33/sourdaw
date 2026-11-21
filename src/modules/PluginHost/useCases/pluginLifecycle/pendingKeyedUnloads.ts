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
