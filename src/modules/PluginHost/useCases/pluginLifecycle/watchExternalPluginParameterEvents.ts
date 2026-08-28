import { logger } from '#/infra/logger/appLogger';

import { onPluginParameterEvents } from '../../repositories/pluginBridge/onPluginParameterEvents';
import { type PluginParameterEvents } from '../../repositories/pluginBridge/types';
import { patchExternalPluginParameterValue } from '../../stores/externalPluginParameterStore';

import {
    type ExternalPluginParameterEdit,
    externalPluginParameterEditObservers,
} from './externalPluginParameterEditObservers';

/**
 * The single live subscription, or `null` when none is running. Held as the
 * in-flight promise so concurrent activations cannot start a second listener
 * while the first is still resolving.
 */
let subscription: Promise<() => void> | null = null;

function toEdit(instanceId: string, event: PluginParameterEvents['events'][number]): ExternalPluginParameterEdit {
    if (event.kind === 'value') {
        return { instanceId, parameterId: event.param_id, kind: 'value', value: event.value };
    }
    return {
        instanceId,
        parameterId: event.param_id,
        kind: event.kind === 'gesture_begin' ? 'gestureBegin' : 'gestureEnd',
    };
}

function publish(edit: ExternalPluginParameterEdit): void {
    // The host's own view of the parameter follows the plugin's. Without this a
    // knob turned in the plugin's editor leaves every reader of the snapshot —
    // the automation menu, lane range resolution — showing the value from before
    // the user touched it.
    if (edit.kind === 'value' && edit.value !== undefined) {
        patchExternalPluginParameterValue(edit.instanceId, edit.parameterId, edit.value);
    }

    for (const observe of externalPluginParameterEditObservers) {
        observe(edit);
    }
}

/**
 * Ensure the `plugin-parameter-events` subscription is live, so the parameter
 * snapshot follows edits the user makes inside a plugin's own editor and every
 * registered observer sees them.
 *
 * Idempotent: the first activation starts it and every later one reuses it. If
 * subscribing fails the slot is released so a later activation retries rather
 * than leaving plugin-side edits permanently unheard.
 */
export function watchExternalPluginParameterEvents(): void {
    if (subscription) {
        return;
    }

    subscription = onPluginParameterEvents((batch) => {
        for (const event of batch.events) {
            publish(toEdit(batch.instance_id, event));
        }
    }).catch((error: unknown) => {
        subscription = null;
        logger.warn(`Failed to subscribe to native plugin parameter events: ${String(error)}`);
        return () => {};
    });
}
