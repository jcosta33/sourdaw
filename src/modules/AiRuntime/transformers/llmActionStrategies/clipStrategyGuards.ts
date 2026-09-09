import { type ProjectContext } from '../../models/ProjectContext';

import { findClip } from './bridgeArgumentGuards';

type NormalizationMode = 'peak' | 'rms' | 'lufs';

export function isNormalizationMode(value: unknown): value is NormalizationMode {
    return value === 'peak' || value === 'rms' || value === 'lufs';
}

export function findEditableClip(context: ProjectContext, clipId: unknown) {
    const target = findClip(context, clipId);
    return target?.clip.locked === true ? undefined : target;
}

export function findEditableAudioClip(context: ProjectContext, clipId: unknown) {
    const target = findClip(context, clipId);
    if (!target || target.clip.type !== 'audio' || target.clip.locked === true) {
        return undefined;
    }
    return target;
}
