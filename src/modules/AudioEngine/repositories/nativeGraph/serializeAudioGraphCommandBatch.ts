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
    const commands = batch.commands.map(serializeAudioGraphCommand);
    const carriesModel = commands.some(
        (command) =>
            command.kind === 'set-grinder-model' ||
            ((command.kind === 'create-track-strip' || command.kind === 'create-bus-strip') &&
                command.devices.some((device) => device.grinderModel !== undefined)) ||
            (command.kind === 'insert-device' && command.device.grinderModel !== undefined)
    );
    const wire: { -readonly [Key in keyof NativeGraphWireBatch]: NativeGraphWireBatch[Key] } = {
        schemaVersion: carriesModel ? 2 : 1,
        commands,
    };
    if (batch.correlation) {
        wire.correlation = { ...batch.correlation };
    }
    if (batch.replaceTopology) {
        wire.replaceTopology = true;
    }
    return wire;
}
