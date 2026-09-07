/**
 * The baked buffer a frozen track plays instead of its own material (#3068).
 *
 * `scheduleTrackClips` is the law it states: a frozen track's clips are not
 * scheduled at all, its bake is, and that bake is connected past the device
 * chain because the processing is already printed into it. Every live producer
 * has to agree about which strips are in that state — the audio programme
 * replaces their playback, and the MIDI producer must not send notes to an
 * instrument whose output the bake already carries — so the predicate lives
 * here rather than inside either of them.
 *
 * The anchor is where `scheduleFrozenTrack` renders from: the track's earliest
 * clip start, not timeline zero.
 */

import { type Track } from '#/modules/Arrangement/stores';

export type FrozenBake = Readonly<{ bufferId: string; buffer: AudioBuffer; startBeat: number }>;

export type FrozenBakeInput = Readonly<{
    track: Track;
    /** Decoded material by id — `audioBufferCache.get` in production. */
    readBuffer: (bufferId: string) => AudioBuffer | undefined;
}>;

export function frozenBake({ track, readBuffer }: FrozenBakeInput): FrozenBake | null {
    const { freezeState } = track;
    if (freezeState.status !== 'frozen' || !freezeState.frozenBufferId) {
        return null;
    }
    const buffer = readBuffer(freezeState.frozenBufferId);
    if (!buffer) {
        return null;
    }
    return {
        bufferId: freezeState.frozenBufferId,
        buffer,
        // A track with no clips has nothing earlier than the timeline head.
        startBeat: track.clips.length > 0 ? Math.min(...track.clips.map((clip) => clip.startBeat)) : 0,
    };
}
