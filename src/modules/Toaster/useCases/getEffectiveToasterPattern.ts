import { getValidMorphState, type Pattern, type ToasterKit } from '../models/ToasterKit';

import { morphPatterns } from './patternMorph';

export function getEffectiveToasterPattern(kit: ToasterKit): { sourcePattern: Pattern; pattern: Pattern } | null {
    const sourcePattern = kit.patterns.find((candidate) => candidate.id === kit.activePatternId);
    if (!sourcePattern) {
        return null;
    }
    const morph = getValidMorphState(kit);
    if (!morph.enabled || !morph.targetPatternId) {
        return { sourcePattern, pattern: sourcePattern };
    }
    const targetPattern = kit.patterns.find((candidate) => candidate.id === morph.targetPatternId);
    if (!targetPattern) {
        return { sourcePattern, pattern: sourcePattern };
    }
    return { sourcePattern, pattern: morphPatterns(sourcePattern, targetPattern, morph.position) };
}
