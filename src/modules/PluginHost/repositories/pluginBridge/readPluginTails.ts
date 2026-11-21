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
        candidate.tail_samples >= 0 &&
        typeof candidate.sequence === 'number' &&
        Number.isSafeInteger(candidate.sequence) &&
        candidate.sequence > 0
    );
}

/**
 * How long the host gets to answer. The host bounds each instance to 50 ms, so
 * this is far past its worst case for a project's instances; an export waits on
 * the answer, and a hung call must cost it the refresh, not the export.
 */
export const PLUGIN_TAIL_READ_DEADLINE_MS = 2000;

const NO_ANSWER_BY_DEADLINE = Symbol('no answer by the deadline');

/** The invoke's answer, or `NO_ANSWER_BY_DEADLINE` when it has not come in time. A later answer is discarded. */
async function answerWithinDeadline(invocation: Promise<unknown>): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<typeof NO_ANSWER_BY_DEADLINE>((resolve) => {
        timer = setTimeout(() => {
            resolve(NO_ANSWER_BY_DEADLINE);
        }, PLUGIN_TAIL_READ_DEADLINE_MS);
    });
    try {
        return await Promise.race([invocation, deadline]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Ask the native host for each named instance's processing tail as the plugin
 * reports it now.
 *
 * VST3 has no tail-changed notification, so a tail revised after load reaches
 * the app only when it asks. An instance the host could not read is absent from
 * the answer, and so is a reading that does not have the wire shape. Browser dev
 * mode has no native host and answers an empty list, and so does a host that has
 * not answered within `PLUGIN_TAIL_READ_DEADLINE_MS`: the caller keeps the
 * figures it has.
 */
export async function readPluginTails(instanceIds: readonly string[]): Promise<PluginTailReading[]> {
    if (!isDesktopRuntime()) {
        return [];
    }
    const answer = await answerWithinDeadline(desktopInvoke('read_plugin_tails', { instanceIds: [...instanceIds] }));
    if (answer === NO_ANSWER_BY_DEADLINE) {
        return [];
    }
    if (!Array.isArray(answer)) {
        throw new TypeError('read_plugin_tails answered something other than a list');
    }
    return answer.filter(isPluginTailReading);
}
