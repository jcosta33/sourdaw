import { type AudioSourceStateSnapshot } from '#/utils/handlerContract';

export function isAudioSourceStateSnapshot(value: unknown): value is AudioSourceStateSnapshot {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    return (
        Object.keys(value).every((key) =>
            ['audioOffsetSeconds', 'audioOffsetBeats', 'audioLoopStartSeconds'].includes(key)
        ) &&
        (!('audioLoopStartSeconds' in value) ||
            value.audioLoopStartSeconds === null ||
            (typeof value.audioLoopStartSeconds === 'number' && Number.isFinite(value.audioLoopStartSeconds))) &&
        'audioOffsetSeconds' in value &&
        'audioOffsetBeats' in value &&
        (value.audioOffsetSeconds === null ||
            (typeof value.audioOffsetSeconds === 'number' && Number.isFinite(value.audioOffsetSeconds))) &&
        (value.audioOffsetBeats === null ||
            (typeof value.audioOffsetBeats === 'number' && Number.isFinite(value.audioOffsetBeats)))
    );
}
