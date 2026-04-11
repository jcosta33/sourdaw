import { getEffectiveGain } from '#/modules/Arrangement/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import { setTrackGain as engineSetTrackGain } from '#/modules/AudioEngine/useCases';

export function applyVcaGains(): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }
    for (const track of tracks) {
        if (!track.vcaGroupId || track.muted) {
            continue;
        }
        const effective = getEffectiveGain(track.id, track.gain);
        engineSetTrackGain(track.id, effective);
    }
}