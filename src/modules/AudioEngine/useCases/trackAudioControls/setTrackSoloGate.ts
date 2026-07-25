import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * FX-8 — apply solo-in-place gating to a track's strip.
 *
 * Distinct from {@link setTrackMute}: the mute node sits downstream of the
 * pre-fader send tap, so muting a track deliberately leaves its cue sends
 * feeding their buses. Solo gating has to stop the track everywhere, so it acts
 * on the pre-fader tap instead.
 */
export function setTrackSoloGate(trackId: string, gated: boolean): void {
    audioEngine.setTrackSoloGate(trackId, gated);
}
