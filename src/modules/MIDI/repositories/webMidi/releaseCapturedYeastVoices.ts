import { pendingYeastRelease } from './pendingYeastRelease';
import { releaseHeldYeastVoices } from './releaseHeldYeastVoices';

/**
 * End every voice a Yeast rack started on an instrument track at one channel
 * and pitch, through the release its note-on captured, so the note-off reaches
 * the device and pad that voice actually sounds on. Generated voices and those
 * a released key left behind live in the route-keyed registry; a held key's
 * own transformed voices live on its active note. A voice no release was
 * captured for (a drum kit or the built-in synth) carries its own length.
 *
 * `sampleFrame` is omitted for an immediate release.
 */
export function releaseCapturedYeastVoices(
    instrumentTrackId: string,
    channel: number,
    pitch: number,
    sampleFrame?: number
): void {
    pendingYeastRelease.releaseTrackPitch(instrumentTrackId, channel, pitch, sampleFrame, 0);
    releaseHeldYeastVoices(instrumentTrackId, channel, pitch, sampleFrame);
}
