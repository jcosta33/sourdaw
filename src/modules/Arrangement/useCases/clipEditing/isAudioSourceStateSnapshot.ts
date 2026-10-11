import { type AudioSourceStateSnapshot } from '#/utils/handlerContract';

export function isAudioSourceStateSnapshot(value: unknown): value is AudioSourceStateSnapshot {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    return (
        Object.keys(value).length === 2 &&
        'audioOffsetSeconds' in value &&
        'audioOffsetBeats' in value &&
        (value.audioOffsetSeconds === null ||
            (typeof value.audioOffsetSeconds === 'number' && Number.isFinite(value.audioOffsetSeconds))) &&
        (value.audioOffsetBeats === null ||
            (typeof value.audioOffsetBeats === 'number' && Number.isFinite(value.audioOffsetBeats)))
    );
}
