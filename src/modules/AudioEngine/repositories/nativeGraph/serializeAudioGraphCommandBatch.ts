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

export function serializeAudioGraphCommandBatch(batch: AudioGraphCommandBatch): NativeGraphWireBatch {
    return {
        schemaVersion: batch.schemaVersion,
        ...(batch.correlation ? { correlation: { ...batch.correlation } } : {}),
        ...(batch.replaceTopology ? { replaceTopology: true } : {}),
        commands: batch.commands.map(serializeAudioGraphCommand),
    };
}
