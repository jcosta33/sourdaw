import { desktopListen, isDesktopRuntime } from '#/utils/desktopBridge';

import { type AudioGraphAttachedPlugin } from '../../models/AudioGraphBackend';

/** The `plugins-attached` wire payload, snake_case like the other plugin events. */
type PluginsAttachedPayload = Readonly<{ instance_ids: readonly string[] }>;

function isPluginsAttachedPayload(value: unknown): value is PluginsAttachedPayload {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const instanceIds = (value as Partial<PluginsAttachedPayload>).instance_ids;
    return Array.isArray(instanceIds) && instanceIds.every((instanceId) => typeof instanceId === 'string');
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
