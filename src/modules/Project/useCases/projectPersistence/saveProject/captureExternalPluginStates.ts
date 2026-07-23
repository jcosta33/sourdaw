import { trackStore } from '#/modules/Arrangement/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import { readPluginState } from '#/modules/PluginHost/useCases';

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
 * failure). Unchanged chunks are skipped to avoid needless CRDT churn.
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
            if (device.type !== 'external-plugin' || !device.externalInstanceId) {
                continue;
            }

            let stateChunk: string;
            try {
                stateChunk = await readPluginState(device.externalInstanceId);
            } catch {
                // A failed read must not clobber the stored chunk (missing/failed plugin).
                continue;
            }

            if (stateChunk.length === 0 || stateChunk === device.externalStateChunk) {
                continue;
            }

            await executeAppAction(
                { type: 'setExternalPluginState', payload: { deviceId: device.id, stateChunk } },
                { skipMacroRecording: true }
            );
        }
    }
}
