import { type AudioDeviceStrategy } from './AudioDeviceStrategy';

export type CreateWithheldDeviceStrategyInput = {
    /**
     * Whether the offline scheduler should treat this device as the track's
     * instrument. It must be the withheld device's own family verdict, not a
     * constant: a withheld *effect* that claimed the track's notes would
     * swallow them and leave the real instrument behind it silent, which is
     * the MD-4 defect `acceptsNotes` exists to prevent.
     */
    acceptsNotes: boolean;
};

/**
 * The offline stand-in for a device release admission refuses to build.
 *
 * A withheld device is not a device that failed to load, and the two must not
 * share a path. A load failure is an environment fault: the device is dropped,
 * the export warns, and — because `scheduleTrackClips` reads a chain with no
 * `instrumentControls` as "this track has no instrument" — a MIDI track then
 * renders through the builtin fallback synth. That substitution is tolerable
 * for a device that *should* have worked, because the alternative is refusing
 * an export over a transient fault.
 *
 * It is not tolerable for a withheld one. Withholding is a permanent product
 * decision, and every project saved before it still carries the device, so the
 * substitution would be the *normal* outcome rather than an edge: opening such
 * a project and exporting it would ship a sawtooth lead where the instrument
 * was, while live playback of the same project stays silent and says so.
 * `createWebAudioEngine` adds no node for a withheld type and notifies that the
 * project data is preserved but the device will remain silent — so silence is
 * what playback contains, and silence is therefore what the render must
 * contain.
 *
 * This is the shape `runOfflineInstrumentSetup`'s catch already uses for a
 * device whose setup fails: keep the device *present* in the chain, unconfigured
 * and silent, rather than remove it. Present-and-silent is a symptom a user
 * reports; a plausible wrong instrument is one they ship.
 *
 * The node is a unity pass-through rather than a zero gain, because that is
 * what live does. Live never inserts the withheld node at all, so an upstream
 * signal reaches the rest of the chain unchanged; a zero gain here would
 * silence the whole track over a withheld *insert*. An instrument has nothing
 * upstream, so pass-through and silence are the same thing for it.
 *
 * Freeze needs no separate refusal on top of this. A silent instrument with
 * notes scheduled into it is exactly the input `detectSilentBake` is built to
 * catch, so the bake is refused by the guard that already owns that decision
 * rather than by a second one that could disagree with it.
 */
export function createWithheldDeviceStrategy(
    ctx: BaseAudioContext,
    { acceptsNotes }: CreateWithheldDeviceStrategyInput
): AudioDeviceStrategy {
    const passThrough = ctx.createGain();
    passThrough.gain.value = 1;
    return {
        node: { inputNode: passThrough, outputNode: passThrough, nodes: [passThrough] },
        acceptsNotes,
        setParam: () => {},
        // No parameter of a device that does not exist in this build can be
        // automated. Returning `null` is what the offline automation scheduler
        // already reads as "this device cannot take this lane".
        resolveOfflineAutomation: () => null,
        setBypass: () => {},
        noteOn: () => {},
        noteOff: () => {},
    };
}
