import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { type PadState } from '../../models/ToasterKit';
import { updatePad } from '../../stores/toasterStore';

import { findReadyToasterControlsOnStrip } from './findReadyToasterControlsOnStrip';
import { padLatest, padPending } from './toasterPadParamQueue';

const STRING_FIELDS = new Set(['engineType', 'name', 'color']);

/** Every `PadState` field the model types as a boolean, read off the model itself. */
type BooleanPadField = { [Key in keyof PadState]: PadState[Key] extends boolean ? Key : never }[keyof PadState];

/**
 * The boolean pad fields, enumerated from `PadState` rather than listed by hand:
 * this is a total `Record`, so adding a boolean field to the model without
 * deciding what it does here is a compile error rather than a silent omission.
 *
 * They need their own branch because the two sides of this function speak
 * different types for the same control. The engine's pad params are uniformly
 * numeric on the wire (`Pad::set_param` in `crates/daw-dsp/src/toaster/pad.rs`
 * reads mute as `value > 0.5`), while the store field is a boolean that the
 * persisted kit chunk only accepts as one — `readPads` in `ToasterKitState.ts`
 * gates on `typeof stored.muted === 'boolean'`. Writing the raw 1 into the store
 * would leave the pad muted for this session and unmuted on the next project
 * load.
 */
const BOOLEAN_PAD_FIELDS: Record<BooleanPadField, true> = { muted: true, soloed: true };
const BOOLEAN_FIELDS = new Set<string>(Object.keys(BOOLEAN_PAD_FIELDS));

function flushPadParam(cacheKey: string): void {
    padPending.delete(cacheKey);
    const entry = padLatest.get(cacheKey);
    if (!entry) {
        return;
    }
    padLatest.delete(cacheKey);

    const target = resolveEligibleDeviceWriteTarget(entry.deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    const strip = getTrackStrip(target.trackId);
    if (!strip) {
        return;
    }
    const toasterControls = findReadyToasterControlsOnStrip({ strip, deviceId: entry.deviceId });
    if (toasterControls) {
        toasterControls.setPadParam(entry.pad, entry.name, entry.value);
    }
}

export function setToasterPadParam(deviceId: string, padIndex: number, key: keyof PadState, value: number): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    if (BOOLEAN_FIELDS.has(key)) {
        updatePad(deviceId, padIndex, { [key]: value > 0 });
    } else if (!STRING_FIELDS.has(key)) {
        updatePad(deviceId, padIndex, { [key]: value });
    }

    const cacheKey = `${deviceId}_${padIndex}_${key}`;
    padLatest.set(cacheKey, { deviceId, pad: padIndex, name: key, value });
    if (!padPending.has(cacheKey)) {
        const rafId = requestAnimationFrame(() => flushPadParam(cacheKey));
        padPending.set(cacheKey, { deviceId, rafId });
    }
}
