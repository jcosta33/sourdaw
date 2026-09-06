/**
 * Carry over unlanded queued stamps from an outgoing pass or span to an incoming one
 * (#3068, #3464, #3568, D3.c.4b).
 */

import { type LiveAutomationWriterTarget } from './nativeLiveAutomationWriterState';

/** The identity the engine addresses a queue by: the whole target, spelled out. */
function targetKey(slot: LiveAutomationWriterTarget): string {
    const { target } = slot;
    if (target.kind === 'track-send-level') {
        return `${target.kind}:${target.trackId}:${target.busId}`;
    }
    if (target.kind === 'device-parameter') {
        return `${target.kind}:${target.trackId}:${target.deviceId}:${target.parameterId}`;
    }
    return `${target.kind}:${target.trackId}`;
}

/**
 * Whether a locate cancels what this slot has queued.
 *
 * Only for a strip parameter. `QueueBudgets::apply_seek`
 * (`crates/sourdaw-native/src/commands/graph.rs`) walks `self.automation` and
 * leaves the device-parameter depths untouched, deliberately: a hosted stamp
 * has no cancellation law on the engine side, so a mirror that pruned one here
 * would free a slot the engine still charges and the next batch that believed
 * it would be refused whole.
 */
function seekPrunes(slot: LiveAutomationWriterTarget): boolean {
    return slot.target.kind !== 'device-parameter';
}

/** What survives the move out of `slot`, given the locate the incoming pass follows. */
function retained(slot: LiveAutomationWriterTarget, seekFrame: number | null): LiveAutomationWriterTarget['queued'] {
    if (seekFrame === null || !seekPrunes(slot)) {
        return [...slot.queued];
    }
    return slot.queued.filter((stamp) => stamp.startFrame < seekFrame);
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
        const previous = outgoing.get(targetKey(slot));
        slot.queued = previous ? retained(previous, seekFrame) : [];
    }
    const toKeys = new Set(to.map(targetKey));
    for (const slot of from) {
        if (!toKeys.has(targetKey(slot))) {
            const carried = retained(slot, seekFrame);
            if (carried.length > 0) {
                to.push({
                    target: slot.target,
                    writes: [],
                    cursor: 0,
                    queued: carried,
                });
            }
        }
    }
}
