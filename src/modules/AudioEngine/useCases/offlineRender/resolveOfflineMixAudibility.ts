import { deriveEffectiveAudibility } from '#/modules/Arrangement/stores';

import { type captureOfflineRenderInput } from './captureOfflineRenderInput';
import { shouldCreateOfflineStrip } from './shouldCreateOfflineStrip';

/** Keep cue-send sources audible through the same mute/solo topology as live playback. */
export function resolveOfflineMixAudibility(input: ReturnType<typeof captureOfflineRenderInput>) {
    const { tracks, midi } = input.renderContext;
    // Exclude muted, disabled, and structural (folder) tracks from the render.
    // We MUST include folder tracks if they contain a Toaster device, because
    // child tracks send MIDI to the parent Toaster device to generate audio.
    const allRenderableTracks =
        tracks && midi ? tracks.tracks.filter((track) => !track.disabled && shouldCreateOfflineStrip(track)) : [];
    // Effective audibility (mute ∪ solo): the offline mixdown consumes the
    // same Arrangement read model the live solo path does, so a soloed
    // session exports exactly the tracks the engineer monitors (OE-4).
    //
    // Mirror the live solo path's ambiguous-owner guard (#593): a track id
    // that appears more than once in the document has no unambiguous solo
    // owner, so — exactly as toggleTrackState/applySoloLogic does — it is
    // dropped from the strip-id set and can neither engage nor answer solo.
    const projectTracks = tracks?.tracks ?? [];
    const stripTrackIds = new Set(
        allRenderableTracks
            .filter((track) => projectTracks.filter((candidate) => candidate.id === track.id).length === 1)
            .map((track) => track.id)
    );
    const { audibleByTrackId, soloGatedByTrackId } = deriveEffectiveAudibility({
        tracks: projectTracks,
        soloMode: input.soloMode,
        stripTrackIds,
    });
    const sourceTracks = allRenderableTracks.filter((track) => audibleByTrackId.get(track.id) ?? !track.muted);
    // FX-8 — a muted track is silenced by its own `postFaderGain`, which sits
    // downstream of the pre-fader send tap. Live, that leaves its pre-fader
    // (cue) sends still feeding their buses, which is the defining property of
    // a pre-fader tap. The mixdown expressed the mute a second time by refusing
    // to schedule the track at all, so export silently lost cue-send content the
    // engineer was monitoring. Those tracks are scheduled again; their strip's
    // mute node still keeps their direct output out of the mix.
    //
    // Solo-gated tracks stay excluded because their closed pre-fader tap makes
    // their cue sends silent; scheduling them would only render work that cannot
    // reach the mix. A muted track with no live pre-fader send is also skipped.
    //
    // Bus membership is read off the track kind rather than off
    // `busStripsById`, which does not exist yet and is filled from exactly
    // this set of tracks.
    const busTrackIds = new Set(allRenderableTracks.filter((track) => track.kind === 'bus').map((track) => track.id));
    const trackTrackIds = new Set(allRenderableTracks.filter((track) => track.kind !== 'bus').map((track) => track.id));
    const sourceTrackIds = new Set(sourceTracks.map((track) => track.id));
    const cueSendOnlyTracks = allRenderableTracks.filter((track) => {
        if (sourceTrackIds.has(track.id) || (soloGatedByTrackId.get(track.id) ?? false)) {
            return false;
        }
        return track.sends.some((send) => send.preFader && busTrackIds.has(send.busId));
    });
    const scheduledTracks = [...sourceTracks, ...cueSendOnlyTracks];

    return { allRenderableTracks, sourceTracks, scheduledTracks, soloGatedByTrackId, busTrackIds, trackTrackIds };
}
