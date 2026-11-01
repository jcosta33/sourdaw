import { getValidMorphState, type ToasterKit } from '../models/ToasterKit';

import { commitToasterMorphKitChange } from './setMorphPosition/commitToasterMorphKitChange';

export async function copyMorphTargetPattern(deviceId: string): Promise<boolean> {
    return commitToasterMorphKitChange(deviceId, (kit: ToasterKit) => {
        const source = kit.patterns.find((pattern) => pattern.id === kit.activePatternId);
        if (!source) {
            return null;
        }
        const ids = new Set(kit.patterns.map((pattern) => pattern.id));
        let ordinal = 1;
        while (ids.has(`B${ordinal}`)) {
            ordinal += 1;
        }
        const id = `B${ordinal}`;
        const copy = { ...structuredClone(source), id, name: `Pattern ${id}` };
        return {
            ...kit,
            patterns: [...kit.patterns, copy],
            morph: { ...getValidMorphState(kit), targetPatternId: id, enabled: false },
        };
    });
}
