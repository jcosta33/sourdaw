import { getValidMorphState } from '../../models/ToasterKit';

import { commitToasterMorphKitChange } from './commitToasterMorphKitChange';

export async function toggleMorph(deviceId: string): Promise<boolean> {
    return commitToasterMorphKitChange(deviceId, (kit) => {
        const morph = getValidMorphState(kit);
        if (!morph.targetPatternId || morph.targetPatternId === kit.activePatternId) {
            return null;
        }
        return { ...kit, morph: { ...morph, enabled: !morph.enabled } };
    });
}
