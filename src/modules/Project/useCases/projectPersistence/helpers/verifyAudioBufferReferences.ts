import { trackStore } from '#/modules/Arrangement/stores';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

export function verifyAudioBufferReferences(): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const missingClips: string[] = [];
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (
                clip.type === 'audio' &&
                clip.audioBufferId &&
                getCachedAudioBuffer({ bufferId: clip.audioBufferId }) === null
            ) {
                missingClips.push(clip.name);
            }
        }
        if (track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId) {
            if (getCachedAudioBuffer({ bufferId: track.freezeState.frozenBufferId }) === null) {
                missingClips.push(`Frozen track ${track.name}`);
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
