/**
 * Carry over unlanded queued stamps from an outgoing pass or span to an incoming one
 * (#3068, #3464, D3.c.4b).
 */

import { type LiveAutomationWriterTarget } from './nativeLiveAutomationWriterState';

/** The identity the engine addresses a queue by: the whole target, spelled out. */
function targetKey(slot: LiveAutomationWriterTarget): string {
    const { target } = slot;
    if (target.kind === 'track-send-level') {
        return `${target.kind}:${target.trackId}:${target.busId}`;
    }
    return `${target.kind}:${target.trackId}`;
}

export function carryQueuedStamps(
    from: readonly LiveAutomationWriterTarget[],
    to: LiveAutomationWriterTarget[],
    seekFrame: number | null = null
): void {
    if (from === to) {
        return;
    }
    const outgoing = new Map(from.map((slot): [string, LiveAutomationWriterTarget] => [targetKey(slot), slot]));
    for (const slot of to) {
        const previousQueued = outgoing.get(targetKey(slot))?.queued ?? [];
        slot.queued =
            seekFrame === null ? [...previousQueued] : previousQueued.filter((stamp) => stamp.startFrame < seekFrame);
    }
    const toKeys = new Set(to.map(targetKey));
    for (const slot of from) {
        if (!toKeys.has(targetKey(slot))) {
            const retained =
                seekFrame === null ? [...slot.queued] : slot.queued.filter((stamp) => stamp.startFrame < seekFrame);
            if (retained.length > 0) {
                to.push({
                    target: slot.target,
                    writes: [],
                    cursor: 0,
                    queued: retained,
                });
            }
        }
    }
}
