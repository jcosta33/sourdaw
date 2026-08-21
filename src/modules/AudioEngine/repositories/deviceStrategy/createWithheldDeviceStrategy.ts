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
 * was.
 *
 * Do not read the live notification as evidence that playback already does the
 * right thing — it is not, and an earlier version of this comment claimed it
 * was. `TrackNode.addDevice` returns `false` for a withheld type and
 * `createWebAudioEngine` notifies that the project data is preserved but the
 * device will remain silent, which is true of the device and false of the
 * track: `scheduleMidiNotes` finds the worklet-synth device by *type*, fails to
 * find its node, and falls through to the same builtin fallback. Live was
 * substituting a sawtooth too. It is fixed there in the same change, by asking
 * admission the same question this file answers.
 *
 * Silence is what both runtimes must contain, because silence is what a build
 * without the device can honestly produce.
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
 * Freeze does not get its protection from the silence alone. `detectSilentBake`
 * catches an unautomated track this way, but `freezeTrack` passes
 * `bakesAutomation: true` unconditionally and `classifyRenderSilence` abstains
 * whenever the track owns one enabled lane with a point — so an automated
 * instrument track, which is the ordinary case, would still bake. The entry
 * this factory backs is therefore flagged `releaseWithheld`, and that flag
 * travels to the guard on the render tally, where it is refused ahead of every
 * abstention. See `detectSilentBake`.
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
