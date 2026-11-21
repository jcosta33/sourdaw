import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginTailReading } from './types';

function isPluginTailReading(value: unknown): value is PluginTailReading {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<PluginTailReading>;
    return (
        typeof candidate.instance_id === 'string' &&
        typeof candidate.tail_samples === 'number' &&
        Number.isInteger(candidate.tail_samples) &&
        candidate.tail_samples >= 0
    );
}

/**
 * Ask the native host for each named instance's processing tail as the plugin
 * reports it now.
 *
 * VST3 has no tail-changed notification, so a tail revised after load reaches
 * the app only when it asks. An instance the host could not read is absent from
 * the answer, and so is a reading that does not have the wire shape. Browser dev
 * mode has no native host and answers an empty list.
 */
export async function readPluginTails(instanceIds: readonly string[]): Promise<PluginTailReading[]> {
    if (!isDesktopRuntime()) {
        return [];
    }
    const answer: unknown = await desktopInvoke('read_plugin_tails', { instanceIds: [...instanceIds] });
    if (!Array.isArray(answer)) {
        throw new TypeError('read_plugin_tails answered something other than a list');
    }
    return answer.filter(isPluginTailReading);
}
