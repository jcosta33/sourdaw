import { getValidMorphState } from '../../models/ToasterKit';

import { commitToasterMorphKitChange } from './commitToasterMorphKitChange';

export async function setMorphTarget(deviceId: string, patternId: string | null): Promise<boolean> {
    return commitToasterMorphKitChange(deviceId, (kit) => {
        if (
            patternId !== null &&
            (patternId === kit.activePatternId || !kit.patterns.some((pattern) => pattern.id === patternId))
        ) {
            return null;
        }
        const morph = getValidMorphState(kit);
        return morph.targetPatternId === patternId
            ? null
            : { ...kit, morph: { ...morph, targetPatternId: patternId, enabled: false } };
    });
}
