import { activeNotes } from './state';

/**
 * End only the held keys' own transformed voices on an instrument track at one
 * channel and pitch — the releases no route-keyed registry entry holds. The
 * `yeast.notesOff` handler resolves registry voices through the
 * instance-keyed lifecycle path (#4873), which keeps a same-pitch successor on
 * a replacement instrument untouched, so it takes this narrower sweep instead
 * of `releaseCapturedYeastVoices`' full pitch-keyed registry release.
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
