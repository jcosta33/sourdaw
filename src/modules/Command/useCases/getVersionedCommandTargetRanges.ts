import { type CommandBatchRange } from '../models/VersionedCommandBatchEnvelope';
import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

/**
 * The beat span each command touches, read from the musical time references the command itself
 * declares. Every scope that claims to cover the same commands derives its ranges here, so no
 * second derivation can disagree with the compiled batch.
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
        ranges.push({ startBeat: Math.min(...beats), endBeat: Math.max(...beats) });
    }
    return ranges;
}
