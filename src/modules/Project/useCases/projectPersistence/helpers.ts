import { trackStore } from '#/modules/Track/stores/trackStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { undoStore } from '#/modules/Command/stores/undoStore';
import { notifyUser } from '#/helpers/Notification/notifyUser';

export function clearUndoHistory(): void {
    undoStore.set({ past: [], future: [] });
}

export function verifyAudioBufferReferences(): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const missingClips: string[] = [];
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (clip.type === 'audio' && clip.audioBufferId && !audioBufferCache.has(clip.audioBufferId)) {
                missingClips.push(clip.name);
            }
        }
    }

    if (missingClips.length > 0) {
        const clipList =
            missingClips.length <= 3
                ? missingClips.join(', ')
                : `${missingClips.slice(0, 3).join(', ')} and ${missingClips.length - 3} more`;
        notifyUser(`Missing audio buffers for: ${clipList} — re-import the audio files`, 'warning');
    }
}
