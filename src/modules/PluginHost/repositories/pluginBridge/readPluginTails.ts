import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { type PluginTailReadResult, type PluginTailReading } from './types';

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
 * How long the host gets to answer. The host spends up to 50 ms on each
 * instance whose seam the audio thread holds, one instance after another, so
 * its worst case grows with the project: 40 stalled instances take 2 s. Past
 * that a project is already unusable for other reasons, and an export waits on
 * the answer, so a hung call must cost it the refresh and not the export. 2 s
 * is the longest that wait is worth.
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
 * mode has no native host and answers an empty list. A host that has not
 * answered within `PLUGIN_TAIL_READ_DEADLINE_MS` is reported as `timed-out`, not
 * as an empty answer, so the caller can tell a silent host from one that reached
 * no instance and keep the figures it has without asking again.
 */
export async function readPluginTails(instanceIds: readonly string[]): Promise<PluginTailReadResult> {
    if (!isDesktopRuntime()) {
        return { kind: 'answered', readings: [] };
    }
    const answer = await answerWithinDeadline(desktopInvoke('read_plugin_tails', { instanceIds: [...instanceIds] }));
    if (answer === NO_ANSWER_BY_DEADLINE) {
        return { kind: 'timed-out' };
    }
    if (!Array.isArray(answer)) {
        throw new TypeError('read_plugin_tails answered something other than a list');
    }
    return { kind: 'answered', readings: answer.filter(isPluginTailReading) };
}
