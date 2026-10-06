import { type Clip } from '../stores/trackStore';

/**
 * Where a clip's source media would begin on the timeline were it extended back
 * to its own first sample. A clip slipped into its media, or clamped to beat 0
 * while its capture began before it, starts after that point by its offset.
 */
export function clipMediaOriginBeat(clip: Clip): number {
    if (clip.type === 'audio') {
        return clip.startBeat - (clip.audioOffsetBeats ?? 0);
    }
    return clip.startBeat - (clip.midiOffsetBeats ?? 0);
}
