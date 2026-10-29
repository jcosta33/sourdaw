import { withActivePatternId } from '../../models/ToasterKit';

import { commitToasterMorphKitChange } from './commitToasterMorphKitChange';

export async function selectMorphSourcePattern(deviceId: string, patternId: string): Promise<boolean> {
    return commitToasterMorphKitChange(deviceId, (kit) => {
        const nextKit = withActivePatternId(kit, patternId);
        return nextKit === kit ? null : nextKit;
    });
}
