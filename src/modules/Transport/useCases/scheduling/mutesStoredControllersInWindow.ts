import { type TrackStoreState } from '#/modules/Arrangement/stores';
import { type MidiStoreState } from '#/modules/MIDI/stores';

type ScheduledTrackClip = TrackStoreState['tracks'][number]['clips'][number];

type MutesStoredControllersInWindowInput = {
    clips: readonly ScheduledTrackClip[];
    fromBeat: number;
    toBeat: number;
    ccByClipId: MidiStoreState['ccByClipId'];
};

// Found once per clip list: the store replaces a track's list on every clip edit, a mute toggle included, so
// the steady scheduler window walks only the few muted clips and allocates nothing.
const mutedMidiClipsByClipList = new WeakMap<readonly ScheduledTrackClip[], readonly ScheduledTrackClip[]>();

function listMutedMidiClips(clips: readonly ScheduledTrackClip[]): readonly ScheduledTrackClip[] {
    const cached = mutedMidiClipsByClipList.get(clips);
    if (cached) {
        return cached;
    }
    const muted = clips.filter((clip) => clip.muted && clip.type === 'midi');
    mutedMidiClipsByClipList.set(clips, muted);
    return muted;
}

/**
 * Whether a muted clip keeps stored controller moves from the window `[fromBeat, toBeat)`: a muted MIDI clip
 * with a stored controller lane overlaps it. The window's clip selection leaves muted clips out before anything
 * else sees them, so this is where their mute is noticed.
 */
export function mutesStoredControllersInWindow({
    clips,
    fromBeat,
    toBeat,
    ccByClipId,
}: MutesStoredControllersInWindowInput): boolean {
    for (const clip of listMutedMidiClips(clips)) {
        if (clip.startBeat < toBeat && clip.endBeat > fromBeat && (ccByClipId[clip.id]?.length ?? 0) > 0) {
            return true;
        }
    }
    return false;
}
