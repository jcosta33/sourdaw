/**
 * The Crumbs instances the native engine reports attached, by device id (#4204).
 *
 * The renderer's mirror of `commands::crumbs`' engine slot, and the same fact
 * PluginHost's `engineAttached` flag is for a hosted plugin: `create_crumbs`
 * answers `attached` for the instance it just made, and `apply_graph_commands`
 * reports `attachedCrumbs` for every dormant instance a batch took over. There
 * is no later event, so a caller that drops either report reads a sampler the
 * engine is rendering as one it holds nothing for — and the mapper splices a
 * Crumbs device onto its strip only when it does hold the instance, so the
 * carrier law has to answer from this and not from the device's presence.
 *
 * A set of its own rather than a flag on `crumbsStore`, because that store is
 * the persistence subscriber's input: every write to it is compared against the
 * device's `playbackKey` and a change there commits a chunk into project truth.
 * An attach is an engine fact, not a project edit, and putting it there would
 * mark a freshly opened project dirty the first time a batch attached anything.
 *
 * Under-reporting is the safe direction, exactly as it is for a hosted plugin:
 * an instance missing from this set leaves its strip on Web Audio, which is
 * audible; one wrongly in it claims a native body the mapper then refuses by
 * name, taking the whole batch with it.
 */

import { createStore } from '#/infra/store/createStore';

export const crumbsEngineAttachmentStore = createStore<ReadonlySet<string>>({
    initialData: new Set<string>(),
});

/**
 * The instances the engine currently holds, by device id.
 *
 * Read rather than remembered by a caller, for the reason
 * `readAttachedExternalInstanceIds` states about hosted plugins: the two
 * answers drift the moment a batch the caller did not send attaches something,
 * and every batch can.
 */
export function readAttachedCrumbsInstanceIds(): ReadonlySet<string> {
    return crumbsEngineAttachmentStore.value ?? new Set<string>();
}

export function markCrumbsInstanceAttached(deviceId: string): void {
    crumbsEngineAttachmentStore.update((current) => {
        const attached = current ?? new Set<string>();
        if (attached.has(deviceId)) {
            return attached;
        }
        return new Set(attached).add(deviceId);
    });
}

export function markCrumbsInstanceDetached(deviceId: string): void {
    crumbsEngineAttachmentStore.update((current) => {
        const attached = current ?? new Set<string>();
        if (!attached.has(deviceId)) {
            return attached;
        }
        const next = new Set(attached);
        next.delete(deviceId);
        return next;
    });
}

/**
 * Retract every attachment this process is mirroring.
 *
 * The engine retirement and the graph rebuild name no instance: the native side
 * puts every Crumbs slot back to dormant with the engine that held it
 * (`crumbs::detach_from_retired_engine`), so anything left claiming an engine
 * after one of them is claiming a slot that is gone. The next batch re-attaches
 * whatever is still there and reports it, which is what restores the mirror.
 */
export function markEveryCrumbsInstanceDetached(): void {
    crumbsEngineAttachmentStore.update((current) => {
        const attached = current ?? new Set<string>();
        return attached.size === 0 ? attached : new Set<string>();
    });
}
