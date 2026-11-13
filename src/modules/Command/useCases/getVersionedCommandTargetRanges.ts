import { type CommandBatchRange } from '../models/VersionedCommandBatchEnvelope';
import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

/**
 * The beat spans the commands touch, each read from the musical time references a command itself
 * declares, and each listed once in the order a command first touches it. Every scope that claims
 * to cover the same commands derives its ranges here, so no second derivation can disagree with
 * the compiled batch. A scope names where a batch writes, so two commands over one span (one range
 * write per listed track) cover that span once: a scope that named it twice could only be matched
 * by a provider repeating it, and a proposal naming the span once would read as omitting part of it.
 */
export function getVersionedCommandTargetRanges(
    commands: readonly Pick<VersionedCommandEnvelope, 'time'>[]
): CommandBatchRange[] {
    const ranges: CommandBatchRange[] = [];
    for (const command of commands) {
        const beats = command.time
            .filter((time) => time.domain === 'musical' && time.unit === 'beats')
            .map((time) => time.value);
        if (beats.length === 0) {
            continue;
        }
        const range = { startBeat: Math.min(...beats), endBeat: Math.max(...beats) };
        if (!ranges.some((listed) => listed.startBeat === range.startBeat && listed.endBeat === range.endBeat)) {
            ranges.push(range);
        }
    }
    return ranges;
}
