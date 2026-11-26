import { desktopListen, isDesktopRuntime } from '#/utils/desktopBridge';

import { type AudioGraphAttachedPlugin } from '../../models/AudioGraphBackend';

/** The `plugins-attached` wire payload, snake_case like the other plugin events. */
type PluginsAttachedPayload = Readonly<{ instance_ids: readonly string[] }>;

/**
 * One re-attach takes at most the session's hosted-plugin ceiling, the engine's
 * `HOSTED_PLUGIN_RESERVE` (`crates/daw-engine/src/scheduler.rs`), so a payload
 * naming more is not one the native host sent.
 */
const MAX_ATTACHED_INSTANCES = 128;

/** Instance ids are app-minted identifiers far shorter than this; it only bounds a malformed payload. */
const MAX_INSTANCE_ID_LENGTH = 256;

function isInstanceId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_INSTANCE_ID_LENGTH;
}

function isPluginsAttachedPayload(value: unknown): value is PluginsAttachedPayload {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const instanceIds = (value as Partial<PluginsAttachedPayload>).instance_ids;
    return (
        Array.isArray(instanceIds) &&
        instanceIds.length <= MAX_ATTACHED_INSTANCES &&
        instanceIds.every((instanceId) => isInstanceId(instanceId))
    );
}

/**
 * Subscribe to `plugins-attached`, pushed by the native host when it hands the
 * engine plugin instances that no graph batch reported (#7368).
 *
 * A batch's attach can be refused for a moment — an editor close or a call
 * still inside the instance, or an unload of everything — and the native host
 * attaches the instance once that hold is released, with no batch to carry the
 * report. This event is that report. Browser dev mode has no native host, so it
 * subscribes to nothing and the unlisten is a no-op.
 */
export async function onNativePluginsAttached(
    handler: (attached: readonly AudioGraphAttachedPlugin[]) => void
): Promise<() => void> {
    if (!isDesktopRuntime()) {
        return () => {};
    }
    return desktopListen('plugins-attached', (envelope: unknown) => {
        const { payload } = envelope as { payload?: unknown };
        if (!isPluginsAttachedPayload(payload)) {
            return;
        }
        handler(payload.instance_ids.map((instanceId) => ({ instanceId })));
    });
}
