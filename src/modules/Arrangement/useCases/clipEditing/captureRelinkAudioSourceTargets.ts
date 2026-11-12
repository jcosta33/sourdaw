import { type RelinkTarget, RELINK_AUDIO_SOURCE_KEYS } from '../../models/RelinkAudioSourceTarget';
import { type Clip } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';

function captureSource(clip: Clip): RelinkTarget['before'] {
    const source: RelinkTarget['before'] = {};
    for (const key of RELINK_AUDIO_SOURCE_KEYS) {
        const value = clip[key];
        if (value !== undefined) {
            Object.assign(source, { [key]: value });
        }
    }
    return source;
}

export function captureRelinkAudioSourceTargets(sourceBufferId: string, replacementBufferId: string): RelinkTarget[] {
    const targets: RelinkTarget[] = [];
    for (const track of trackStore.value?.tracks ?? []) {
        const capture = (clip: Clip, alternativeId: string | null): void => {
            if (clip.type !== 'audio' || (clip.audioBufferId ?? clip.id) !== sourceBufferId) {
                return;
            }
            const before = captureSource(clip);
            targets.push({
                trackId: track.id,
                trackKind: track.kind,
                activeAlternativeId: track.activeAlternativeId,
                alternativeId,
                clipId: clip.id,
                before,
                after: { ...before, audioBufferId: replacementBufferId },
            });
        };
        for (const clip of track.clips) {
            capture(clip, null);
        }
        for (const alternative of track.alternatives) {
            if (alternative.id === track.activeAlternativeId) {
                continue;
            }
            for (const clip of alternative.clips) {
                capture(clip, alternative.id);
            }
        }
    }
    return targets;
}
