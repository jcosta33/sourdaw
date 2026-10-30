import { getValidMorphState } from '../../models/ToasterKit';

import { commitToasterMorphKitChange } from './commitToasterMorphKitChange';

export async function setMorphPosition(deviceId: string, position: number): Promise<boolean> {
    if (!Number.isFinite(position)) {
        return false;
    }
    const clamped = Math.max(0, Math.min(1, position));
    return commitToasterMorphKitChange(deviceId, (kit) => {
        const morph = getValidMorphState(kit);
        if (!morph.targetPatternId || morph.targetPatternId === kit.activePatternId) {
            return null;
        }
        return morph.position === clamped ? null : { ...kit, morph: { ...morph, position: clamped } };
    });
}
