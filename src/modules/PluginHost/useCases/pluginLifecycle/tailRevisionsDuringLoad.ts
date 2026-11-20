/**
 * Tail changes a plugin reported while its load was still in flight, by
 * instance id.
 *
 * The native host attaches an instance to the engine before the load command
 * returns, and drains each tail change exactly once, so a plugin that revises
 * its tail on its first block — a reverb that sizes itself from the impulse
 * response it just loaded — reports before the load's own answer reaches this
 * process. That answer is the older figure; the revision held here wins when
 * the load seeds the tail store.
 *
 * Only instances in `loadedExternalInstances` are held, so a change for an
 * instance that was never loaded or has been unloaded is still dropped. An
 * entry leaves when its load seeds the store, fails, or the instance is
 * forgotten, and every entry leaves with the graph generation.
 *
 * Ephemeral runtime state, not project truth.
 */
export const tailRevisionsDuringLoad = new Map<string, number>();
