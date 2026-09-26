/**
 * One device as the native engine is addressed about it (#3893, #3124).
 *
 * A device reaches the engine with its `parameterValues` passed through
 * verbatim (`serializeAudioGraphCommand`), and the engine resolves every key of
 * that record against the built-in's own vocabulary — refusing the *whole*
 * batch, by device and key, over one it cannot name. Project truth spells a
 * Fermenter's parameters as the ids a panel authors, so a chain sent unmapped
 * takes down the batch that carries it and every other strip in it.
 *
 * Applied by each producer that puts a device on the wire rather than inside
 * the serializer, because the serializer's job is the shape of the command and
 * this is what the command means.
 *
 * A device with no native body — a hosted plugin, or a type the engine does not
 * build — is returned as it stands, identity included: nothing here is entitled
 * to rewrite a record it holds no vocabulary for.
 *
 * `Device.deviceState` never crosses the wire (`serializeAudioGraphCommand.ts`
 * drops it), yet a body like Toaster's is *more* than its `parameterValues` —
 * its kit lives entirely in `deviceState`. This is the seam that folds it back
 * in before the record leaves: `projectNativeDeviceState` turns a device's
 * opaque state into the numeric record its native body needs, and that record
 * is merged OVER the table projection.
 *
 * One body is not built from a record at all. A Levain instance is built from a
 * *sample bank* the renderer staged under a key, and `map_device` answers `Err`
 * for the device by name when no committed bank stands at that key — which
 * refuses the batch whole on any strip that contributes audio. So the same sink
 * that decodes opaque state also names the bank the state asks for, and the key
 * rides beside the record as `sampleBankKey` — the one field on the wire that is
 * neither project truth nor a parameter, and the reason the return shape is
 * AudioEngine's own device view rather than Arrangement's model.
 *
 * The kit wins on an overlapping name
 * (`master_gain` is both a Toaster descriptor id and a kit field) because the
 * web offline path already resolves that overlap the same way — it replays
 * `parameterValues` while building the offline strategy
 * (`deviceRegistry.createDevice`, `buildDeviceChain.ts`) and only afterwards
 * hydrates the kit (`runOfflineInstrumentSetup` → `prepareOfflineInstrument` →
 * `prepareOfflineToaster`), so the kit's own `master_gain` is the last write
 * the worklet sees. Ordering the merge the same way here keeps the native path
 * agreeing with the offline one on which source wins.
 */

import { type Device, type DeviceStateChunk } from '#/modules/Arrangement/stores';

import { getAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';
import { type AudioGraphDevice as NativeBodyDevice } from '../../models/AudioGraphBackend';

import { BUILTIN_PARAM_NAME_SHAPE, nativeBuiltinBody } from './nativeBuiltinBodies';

/**
 * The projected device state, narrowed to what the wire can actually carry:
 * a key shaped unlike any built-in's vocabulary or a non-finite value would
 * cost the whole `write-device-parameter` batch, exactly as an unmapped
 * `parameterValues` entry would (see `tablePatch` in `nativeBuiltinBodies.ts`).
 * Defence in depth — the projector is expected to already produce shaped,
 * finite entries — rather than trust for a value that crosses a module seam.
 */
function shapedFiniteProjectedState(projected: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
    return Object.fromEntries(
        Object.entries(projected).filter(
            (entry): entry is [string, number] => BUILTIN_PARAM_NAME_SHAPE.test(entry[0]) && Number.isFinite(entry[1])
        )
    );
}

/**
 * Asked unconditionally, even when `deviceState` is `undefined`: not every
 * arm reads `deviceState` at all — Grand Boule's calibration lives in its
 * per-device store, keyed by `deviceId` — so the "nothing committed yet"
 * guard belongs to the arms that actually need a chunk, not to this caller.
 */
type NativeDeviceProjection = Pick<
    ReturnType<typeof getAudioDeviceRuntimeSink>,
    'projectNativeDeviceState' | 'nativeSampleBankKey' | 'nativeModAssignments'
>;

function projectDeviceState(
    deviceId: string,
    deviceType: string,
    deviceState: DeviceStateChunk | undefined,
    projection: NativeDeviceProjection
) {
    return projection.projectNativeDeviceState({ deviceId, deviceType, deviceState });
}

/**
 * The bank key a device's own state names, as an optional field to spread.
 *
 * Absent rather than `undefined` for every device whose body is built from its
 * record: `serializeAudioGraphCommand` omits the field then, and the payload
 * stays byte-identical to what the engine took before banks existed.
 *
 * Both this and `projectDeviceState` below are asked unconditionally, for a
 * device with a chunk and one without, but for different reasons: the bank
 * question, because a chunkless device has no state to project yet still
 * *sounds* something — the owning module's default instrument — and only
 * that module can name the bank for it, so skipping this here would send a
 * fresh Levain naming no bank, which refuses the batch on any audible strip.
 * The state question, because a body's runtime-only state — Grand Boule's
 * MIDI calibration — is keyed by `deviceId`, not by a chunk, so an arm that
 * reads it has something to answer even when `deviceState` is `undefined`.
 */
function sampleBankKeyField(
    deviceType: string,
    deviceState: DeviceStateChunk | undefined,
    projection: NativeDeviceProjection
) {
    const bankKey = projection.nativeSampleBankKey({ deviceType, deviceState });
    return bankKey === null ? {} : { sampleBankKey: bankKey };
}

/**
 * A bacteria device's modulation-assignment table, as an optional field to
 * spread — the same "absent rather than `undefined`" shape [`sampleBankKeyField`]
 * keeps, so `serializeAudioGraphCommand` omits the field and every other
 * device's payload stays byte-identical to what the engine took before this
 * table existed (#4685 slice 2).
 *
 * Asked unconditionally, for the same reason the bank key is: only the owning
 * module can decode `deviceState`, and this is the one seam that reaches it
 * before the record crosses the wire.
 */
function modAssignmentsField(
    deviceType: string,
    deviceState: DeviceStateChunk | undefined,
    projection: NativeDeviceProjection
) {
    const rows = projection.nativeModAssignments({ deviceType, deviceState });
    return rows === null ? {} : { modAssignments: rows };
}

export function projectDeviceForNativeBody(
    device: Device,
    projection: NativeDeviceProjection = getAudioDeviceRuntimeSink()
): NativeBodyDevice {
    const body = nativeBuiltinBody(device.type);
    if (!body) {
        return device;
    }
    const patch = body.projectPatch(device.parameterValues);
    const bank = sampleBankKeyField(device.type, device.deviceState, projection);
    const modAssignments = modAssignmentsField(device.type, device.deviceState, projection);
    const projectedState = projectDeviceState(device.id, device.type, device.deviceState, projection);
    if (!projectedState) {
        return { ...device, ...bank, ...modAssignments, parameterValues: patch };
    }
    return {
        ...device,
        ...bank,
        ...modAssignments,
        parameterValues: { ...patch, ...shapedFiniteProjectedState(projectedState) },
    };
}
