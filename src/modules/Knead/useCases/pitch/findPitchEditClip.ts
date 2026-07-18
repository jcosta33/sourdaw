import { trackStore } from '#/modules/Arrangement/stores';

export type PitchEditClip = {
    id: string;
    type: 'audio';
    fileId?: string;
    audioBufferId?: string;
};

/**
 * Locate an audio clip eligible for a pitch commit. Returns `null` when the clip is
 * missing or is not an audio clip. Read from the live `trackStore`; callers invoke this
 * both when capturing the undo inverse (pre-execute) and when running the render.
 */
export function findPitchEditClip(clipId: string): PitchEditClip | null {
    const tracks = trackStore.value?.tracks ?? [];
    for (const track of tracks) {
        for (const clip of track.clips) {
            const candidate: {
                id: string;
                type: 'audio' | 'midi';
                fileId?: string;
                audioBufferId?: string;
            } = clip;
            if (candidate.id === clipId && candidate.type === 'audio') {
                return {
                    id: candidate.id,
                    type: 'audio',
                    fileId: candidate.fileId,
                    audioBufferId: candidate.audioBufferId,
                };
            }
        }
    }
    return null;
}
