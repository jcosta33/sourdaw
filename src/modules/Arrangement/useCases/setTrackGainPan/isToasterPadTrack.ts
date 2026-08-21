import { type ToasterSyncDeps } from './helpers';

/**
 * Ceiling for a track whose fader mirrors a Toaster pad level, pinned to what
 * `crates/daw-dsp/src/toaster/pad.rs` accepts: `"volume" => value.clamp(0.0,
 * 1.0)`.
 *
 * `setTrackGain` writes one value to two places on such a track — the strip's
 * `GainNode` and the pad's own `volume`. While the fader stopped at unity the
 * pad's clamp never bit and the two stayed identical; a fader that reaches
 * `FADER_MAX_GAIN` splits them, and the pad's doc comment records what the
 * last split cost: "an audible step on release, about 6 dB".
 *
 * The mirror is held at the narrower of the two ranges rather than the pad
 * widened to the fader's, because the pad gain is **in series** with the strip
 * gain, not a copy of it — `createWebAudioEngine` connects the pad output into
 * the child track's `gainNode`, and `ToasterEngine::note_on` applies
 * `vel_norm * pad_cfg.volume` on the way out. One value written to both is
 * therefore applied twice, so widening the pad to `FADER_MAX_GAIN` would give
 * a Toaster pad track `+12 dB` of travel while every other fader has `+6 dB`.
 * Holding the mirror at unity leaves such a track exactly where it was before
 * the fader widened, which is the conservative half of the divergence.
 */
export const TOASTER_PAD_MAX_GAIN = 1;

/**
 * Whether this track's level mirrors a Toaster pad — the structural fact
 * (a child of a track carrying a Toaster), not whether a write to that device
 * would currently be eligible. A fader's range must not flicker with the
 * freeze state of the device behind it.
 */
export function isToasterPadTrack(trackId: string, deps: Pick<ToasterSyncDeps, 'getAllTracks'>): boolean {
    const tracks = deps.getAllTracks();
    const track = tracks.find((time) => time.id === trackId);
    if (!track?.parentId) {
        return false;
    }
    const parent = tracks.find((time) => time.id === track.parentId);
    return parent?.devices.some((data) => data.type === 'toaster') === true;
}
