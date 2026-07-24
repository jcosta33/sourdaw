import { trackStore } from '#/modules/Arrangement/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import { readPluginState } from '#/modules/PluginHost/useCases';

import { capturedNativePluginStateCache } from './capturedNativePluginStateCache';

/**
 * Capture the live state chunk of every loaded native plugin into project truth
 * immediately before a save. For each `external-plugin` device with an instance
 * id, read the host's opaque chunk and commit it (base64) through
 * `executeAppAction`, so it rides the same CRDT write path as the rest of the
 * project and is restored when the instance is next reloaded.
 *
 * A plugin that is absent, failed to instantiate, or produced an empty chunk
 * yields '' from `readPluginState`; that case is skipped so the previously
 * stored chunk survives a round-trip through a machine without the plugin
 * (Decision 0003 — never overwrite saved plugin state on instantiation
 * failure).
 *
 * The write is gated on whether THIS peer's own host state changed since its last
 * capture (`capturedNativePluginStateCache`), not on whether the stored chunk
 * differs. Under collaboration a sync can replace the stored chunk with a peer's
 * value; comparing against the store alone would re-commit the local chunk every
 * autosave tick while the peer did the reverse — an endless ping-pong. Comparing
 * against the self-read baseline makes "host unchanged" a guaranteed no-write.
 *
 * Reads and commits are serialized per device so a slow host cannot flood the
 * IPC bridge and so each commit lands before the next read observes the store.
 */
export async function captureExternalPluginStates(): Promise<void> {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    for (const track of state.tracks) {
        for (const device of track.devices) {
            const instanceId = device.externalInstanceId;
            if (device.type !== 'external-plugin' || !instanceId) {
                continue;
            }

            let stateChunk: string;
            try {
                stateChunk = await readPluginState(instanceId);
            } catch {
                // A failed read must not clobber the stored chunk (missing/failed plugin).
                continue;
            }

            if (stateChunk.length === 0) {
                continue;
            }

            // Self-referential skip: our own host state is unchanged since the last
            // capture for this instance, so there is nothing local to persist —
            // regardless of what a collaboration sync wrote into the store.
            if (stateChunk === capturedNativePluginStateCache.get(instanceId)) {
                continue;
            }

            // Record this peer's fresh host read as the new baseline before any
            // commit, so subsequent ticks compare against it in either branch.
            capturedNativePluginStateCache.set(instanceId, stateChunk);

            // Project truth already holds our host state — nothing to write.
            if (stateChunk === device.externalStateChunk) {
                continue;
            }

            await executeAppAction(
                { type: 'setExternalPluginState', payload: { deviceId: device.id, stateChunk } },
                { skipMacroRecording: true }
            );
        }
    }
}
