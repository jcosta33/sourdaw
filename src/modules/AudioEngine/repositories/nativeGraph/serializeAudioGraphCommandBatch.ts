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
    let timelineLease: string | undefined;
    if (materials) {
        timelineLease = materials.lease;
    } else if (batch.timelineLease) {
        timelineLease = batch.timelineLease;
    }
    const commands = batch.commands.map((command) => {
        const wire = serializeAudioGraphCommand(command);
        if (wire.kind !== 'schedule-clip' || !materials) {
            return wire;
        }
        const materialVersion = materials.versions.get(wire.playback.source.sourceId);
        if (!materialVersion) {
            throw new Error(`Native clip source "${wire.playback.source.sourceId}" has no exact material version`);
        }
        return { ...wire, playback: { ...wire.playback, source: { ...wire.playback.source, materialVersion } } };
    });
    const carriesModel = commands.some(
        (command) =>
            command.kind === 'set-grinder-model' ||
            ((command.kind === 'create-track-strip' || command.kind === 'create-bus-strip') &&
                command.devices.some((device) => device.grinderModel !== undefined)) ||
            (command.kind === 'insert-device' && command.device.grinderModel !== undefined)
    );
    const serialized: NativeGraphWireBatch & { timelineLease?: string } = {
        schemaVersion: carriesModel ? 2 : 1,
        ...(batch.correlation ? { correlation: { ...batch.correlation } } : {}),
        ...(batch.replaceTopology ? { replaceTopology: true } : {}),
        commands,
    };
    if (timelineLease !== undefined) {
        serialized.timelineLease = timelineLease;
    }
    return serialized;
}
