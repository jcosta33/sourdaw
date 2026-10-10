import { pendingYeastRelease } from './pendingYeastRelease';
import { activeNotes } from './state';

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

/**
 * End only the held keys' own transformed voices on an instrument track at one
 * channel and pitch — the releases no route-keyed registry entry holds. The
 * `yeast.notesOff` handler resolves registry voices through the
 * instance-keyed lifecycle path (#4873), which keeps a same-pitch successor on
 * a replacement instrument untouched, so it takes this narrower sweep instead
 * of the full pitch-keyed registry release above.
 */
export function releaseHeldYeastVoices(
    instrumentTrackId: string,
    channel: number,
    pitch: number,
    sampleFrame?: number
): void {
    for (const held of activeNotes.values()) {
        if (held.instrumentTrackId !== instrumentTrackId || held.channel !== channel) {
            continue;
        }
        const release = held.yeastVoiceReleases?.get(pitch);
        if (!release) {
            continue;
        }
        held.yeastVoiceReleases?.delete(pitch);
        release(sampleFrame, 0);
    }
}
