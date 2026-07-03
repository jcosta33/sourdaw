import { type CrustPatch } from '../../models/CrustPatch';
import { setCrustParam } from '../../stores/crustStore';

import { createFlushHandlers } from './createFlushHandlers';
import { crustBridgeDeps, encodeCrustValue, findDeviceRefCrust, paramBatcher } from './helpers';

const { flushParam: flushCrustParam } = createFlushHandlers(crustBridgeDeps);

export function setCrustParamWithAudio<Key extends keyof CrustPatch>(
    deviceId: string,
    key: Key,
    value: CrustPatch[Key]
): void {
    // Encode before touching the store so we can tell apart three cases:
    //  - null      → the key has an engine index table but this value isn't in
    //                it (corrupt/unknown enum). Skip BOTH writes or the store
    //                and engine diverge.
    //  - undefined → store-only key with no engine encoding (streamingPreset,
    //                name). Still write the store; only the engine push is
    //                skipped — otherwise selecting a loudness target would
    //                never reach patch.streamingPreset.
    //  - number    → encoded; write the store and schedule the engine push.
    const encodedValue = encodeCrustValue(key, value);
    if (encodedValue === null) {
        return;
    }

    setCrustParam(key, value);

    if (encodedValue === undefined) {
        return;
    }

    const ref = findDeviceRefCrust(deviceId);
    if (!ref) {
        return;
    }

    const compositeKey = `${deviceId}:${key}`;
    paramBatcher.schedule(compositeKey, { ref, key, value: encodedValue }, flushCrustParam);
}
