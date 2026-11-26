import { type NativeTailFigure } from '../../stores/externalPluginTailStore';

/**
 * Tail figures the native host reported while its load was still in flight, by
 * instance id, whether as a `plugin-tail-changed` event or as a `read_plugin_tails`
 * answer. The newest by native sequence is kept.
 *
 * The native host attaches an instance to the engine before the load command
 * returns, and drains each tail change exactly once, so a plugin that revises
 * its tail on its first block — a reverb that sizes itself from the impulse
 * response it just loaded — reports before the load's own answer reaches this
 * process. When the load seeds the tail store the held figure is ranked against
 * the load's `tail_sequence`: it wins only if its native sequence is higher, so a
 * figure the host numbered before the load read its own is ignored.
 *
 * Only instances in `loadedExternalInstances` are held, so a change for an
 * instance that was never loaded or has been unloaded is still dropped. An
 * entry leaves when its load seeds the store, fails, or the instance is
 * forgotten, and every entry leaves with the graph generation.
 *
 * Ephemeral runtime state, not project truth.
 */
export const tailRevisionsDuringLoad = new Map<string, NativeTailFigure>();

/** Hold a figure for the load to seed, unless one with a later native sequence is already held. */
export function holdTailDuringLoad(instanceId: string, figure: NativeTailFigure): void {
    const held = tailRevisionsDuringLoad.get(instanceId);
    if (held !== undefined && held.sequence >= figure.sequence) {
        return;
    }
    tailRevisionsDuringLoad.set(instanceId, figure);
}
