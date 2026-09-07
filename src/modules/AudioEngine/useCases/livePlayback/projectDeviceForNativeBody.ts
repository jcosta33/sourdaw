/**
 * One device as the native engine is addressed about it (#3893).
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
 */

import { type Device } from '#/modules/Arrangement/stores';

import { nativeBuiltinBody } from './nativeBuiltinBodies';

export function projectDeviceForNativeBody(device: Device): Device {
    const body = nativeBuiltinBody(device.type);
    if (!body) {
        return device;
    }
    return { ...device, parameterValues: body.projectPatch(device.parameterValues) };
}
