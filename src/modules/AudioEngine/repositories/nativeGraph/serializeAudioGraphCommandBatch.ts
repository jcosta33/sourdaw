/**
 * A whole contract batch onto the wire, command by command through
 * `serializeAudioGraphCommand` — see that file for the wire-mirror law. Absent
 * correlation stays absent: absence is meaningful in the contract (a snapshot
 * render cannot go stale), so `undefined` never becomes a field. An unset
 * `replaceTopology` stays absent for the same reason, and the native side reads
 * its absence as the additive batch every existing producer sends.
 */

import { type AudioGraphCommandBatch } from '../../models/AudioGraphBackend';

import { serializeAudioGraphCommand, type NativeGraphWireBatch } from './serializeAudioGraphCommand';

export function serializeAudioGraphCommandBatch(
    batch: AudioGraphCommandBatch,
    materials?: Readonly<{ lease: string; versions: ReadonlyMap<string, string> }>
): NativeGraphWireBatch & Readonly<{ timelineLease?: string }> {
    return {
        schemaVersion: batch.schemaVersion,
        ...(materials
            ? { timelineLease: materials.lease }
            : batch.timelineLease
              ? { timelineLease: batch.timelineLease }
              : {}),
        ...(batch.correlation ? { correlation: { ...batch.correlation } } : {}),
        ...(batch.replaceTopology ? { replaceTopology: true } : {}),
        commands: batch.commands.map((command) => {
            const wire = serializeAudioGraphCommand(command);
            if (wire.kind !== 'schedule-clip' || !materials) {
                return wire;
            }
            const materialVersion = materials.versions.get(wire.playback.source.sourceId);
            if (!materialVersion) {
                throw new Error(`Native clip source "${wire.playback.source.sourceId}" has no exact material version`);
            }
            return { ...wire, playback: { ...wire.playback, source: { ...wire.playback.source, materialVersion } } };
        }),
    };
}
