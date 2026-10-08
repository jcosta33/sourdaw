import { type TrackStoreState } from '#/modules/Arrangement/stores';

type ScheduledTrackClip = TrackStoreState['tracks'][number]['clips'][number];

// Found once per clip list: the store replaces a track's list on every clip edit, a mute toggle included, so
// the steady scheduler window walks only the few muted clips and allocates nothing.
const mutedMidiClipsByClipList = new WeakMap<readonly ScheduledTrackClip[], readonly ScheduledTrackClip[]>();

/**
 * The muted MIDI clips of one track's clip list. The window's clip selection leaves muted clips out before
 * anything else sees them, so this is where the scheduler notices what their mute withholds.
 */
export function listMutedMidiClips(clips: readonly ScheduledTrackClip[]): readonly ScheduledTrackClip[] {
    const cached = mutedMidiClipsByClipList.get(clips);
    if (cached) {
        return cached;
    }
    const muted = clips.filter((clip) => clip.muted && clip.type === 'midi');
    mutedMidiClipsByClipList.set(clips, muted);
    return muted;
}
