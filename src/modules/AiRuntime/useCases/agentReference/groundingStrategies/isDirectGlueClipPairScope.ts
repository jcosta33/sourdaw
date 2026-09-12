import { type ProjectContext } from '../../../models/ProjectContext';

import { getGlueClipPairTargetPattern } from './getGlueClipPairTargetPattern';
import { normalizePromptText } from './normalizePromptText';
import { type ActionPromptScope } from './promptScope';
import { stripPoliteGlueCommandCarrier } from './stripPoliteGlueCommandCarrier';

export function isDirectGlueClipPairScope(
    actionScope: ActionPromptScope,
    assertedClipIds: unknown,
    context: ProjectContext
): boolean {
    if (
        !Array.isArray(assertedClipIds) ||
        assertedClipIds.length !== 2 ||
        !assertedClipIds.every((clipId): clipId is string => typeof clipId === 'string')
    ) {
        return false;
    }
    const normalizedScope = normalizePromptText(stripPoliteGlueCommandCarrier(actionScope.text));
    if (/^(?:glue|join)(?: the)? selected clips$/u.test(normalizedScope)) {
        const selectedIds = new Set(context.selectedClipIds);
        return selectedIds.size === 2 && assertedClipIds.every((clipId) => selectedIds.has(clipId));
    }
    const targetPattern = getGlueClipPairTargetPattern(assertedClipIds, context);
    if (!targetPattern) {
        return false;
    }
    return new RegExp(`^(?:glue|join) ${targetPattern}$`, 'u').test(normalizedScope);
}
