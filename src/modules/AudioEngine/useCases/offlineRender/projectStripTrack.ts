import { type Track } from '#/modules/Arrangement/stores';

import { isOfflineInstrumentDevice } from './isOfflineInstrumentDevice';

/** Fader/pan values a bounce uses when the caller asks for the take without mixer moves. */
const NEUTRAL_GAIN = 0.8;
const NEUTRAL_PAN = 0;

/** True unity — the identity of the fader, not the default position of one. */
const UNITY_GAIN = 1;
const CENTRE_PAN = 0;

/**
 * What this render does with the target track's own fader and panner.
 *
 * The rule that decides it, stated once here because it was previously answered
 * ad hoc in three places:
 *
 * > A mixer value belongs in the print exactly when the node that applies it
 * > will **not** be applied again afterwards.
 *
 * - `'bake'` — the print is the finished thing (bounce, mixdown). These nodes do
 *   not run again, so their values have to be in the samples or they are lost.
 * - `'keepLive'` — the print is replayed *through these same nodes* (freeze).
 *   Live attaches the frozen buffer to `preFaderTap` and the mixdown attaches it
 *   to the fader node, so both replay paths run the fader and panner again.
 *   Anything baked here is therefore applied twice.
 *
 * The VCA group master is decided by the same rule and lands the same way — see
 * `resolveContributorVcaMultiplier`, which already excludes the target because
 * its fader stays live. `'keepLive'` is that exclusion extended to the two
 * values that were still being baked.
 */
export type TargetMixerDisposition = 'bake' | 'keepLive';

export type ProjectStripTrackInput = {
    track: Track;
    isTarget: boolean;
    includeInserts: boolean;
    includeAutomation: boolean;
    targetMixer: TargetMixerDisposition;
};

/**
 * Shape the track the *strip* is built from. Only the target honours the bounce
 * options; upstream tracks always render as the session has them, since their
 * contribution is what the target's chain is fed.
 */
export function projectStripTrack({
    track,
    isTarget,
    includeInserts,
    includeAutomation,
    targetMixer,
}: ProjectStripTrackInput): Track {
    if (!isTarget) {
        return track;
    }

    let devices = track.devices;
    if (!includeInserts) {
        devices = track.devices.filter((device) => isOfflineInstrumentDevice(device.type));
    }

    if (targetMixer === 'keepLive') {
        // Unity and centre, not `NEUTRAL_GAIN`. That constant is the default
        // *track* gain (0.8), so reusing it here would bake a fixed -1.94 dB
        // into every frozen buffer — a quieter version of the bug it replaces
        // rather than a fix. The identity of a gain node is 1.
        return { ...track, devices, gain: UNITY_GAIN, pan: CENTRE_PAN };
    }

    if (includeAutomation) {
        return { ...track, devices };
    }
    return { ...track, devices, gain: NEUTRAL_GAIN, pan: NEUTRAL_PAN };
}
