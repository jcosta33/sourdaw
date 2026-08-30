import { desktopListen, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginParameterEvent, type PluginParameterEventKind, type PluginParameterEvents } from './types';

const PARAMETER_EVENT_KINDS: readonly PluginParameterEventKind[] = ['gesture_begin', 'value', 'gesture_end'];

function isPluginParameterEvent(value: unknown): value is PluginParameterEvent {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<PluginParameterEvent>;
    if (typeof candidate.param_id !== 'number' || !Number.isInteger(candidate.param_id)) {
        return false;
    }
    if (!PARAMETER_EVENT_KINDS.includes(candidate.kind as PluginParameterEventKind)) {
        return false;
    }
    // A gesture boundary carries no setting, and a value event that lost its
    // number is not a reading — admitting either would publish a control
    // position the plugin never reported.
    if (candidate.kind === 'value') {
        return typeof candidate.value === 'number' && Number.isFinite(candidate.value);
    }
    return candidate.value === undefined;
}

function isPluginParameterEvents(value: unknown): value is PluginParameterEvents {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<PluginParameterEvents>;
    if (typeof candidate.instance_id !== 'string' || !Array.isArray(candidate.events)) {
        return false;
    }
    return candidate.events.every(isPluginParameterEvent);
}

/**
 * Subscribe to `plugin-parameter-events`, pushed by the native host after a
 * plugin changed one of its own parameters.
 *
 * Push, not poll: an edit made inside a plugin's editor never passes through
 * this app, so nothing here would know to ask. Browser dev mode has no native
 * host, so it subscribes to nothing and the unlisten is a no-op.
 */
export async function onPluginParameterEvents(handler: (events: PluginParameterEvents) => void): Promise<() => void> {
    if (!isDesktopRuntime()) {
        return () => {};
    }
    return desktopListen('plugin-parameter-events', (payload: unknown) => {
        const event = payload as { payload?: unknown };
        if (!isPluginParameterEvents(event.payload)) {
            return;
        }
        handler(event.payload);
    });
}
