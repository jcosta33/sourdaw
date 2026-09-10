import { type CrustPatch } from '../../models/CrustPatch';
import { setCrustParam } from '../../stores/crustStore';

import { algorithmFromStyle } from './algorithmFromStyle';
import { createFlushHandlers } from './createFlushHandlers';
import { crustBridgeDeps, encodeCrustValue, paramBatcher } from './helpers';

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

    const target = crustBridgeDeps.resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    setCrustParam(key, value);

    let derivedAlgorithm: number | undefined;
    if (key === 'style' && typeof value === 'string') {
        const algorithm = algorithmFromStyle(value);
        if (algorithm !== null) {
            // Engine already applied from_style_index from the style write, so
            // the derived key never reaches the engine; it is persisted from
            // the same flush as style, after it, because the web host replays
            // a record in first-insertion order and style must precede the
            // algorithm it derives.
            setCrustParam('algorithm', algorithm);

            const encodedAlgorithm = encodeCrustValue('algorithm', algorithm);
            if (typeof encodedAlgorithm === 'number') {
                derivedAlgorithm = encodedAlgorithm;
            }
        }
    }

    if (encodedValue === undefined) {
        return;
    }

    const compositeKey = `${deviceId}:${key}`;
    paramBatcher.schedule(compositeKey, { deviceId, key, value: encodedValue, derivedAlgorithm }, flushCrustParam);
}
