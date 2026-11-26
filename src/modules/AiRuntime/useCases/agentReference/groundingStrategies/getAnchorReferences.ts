import { type getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';

import { type PromptReferenceSpan } from './bindDecibelFiguresToReferences';
import { getNamedReferenceSpans } from './getNamedReferenceSpans';
import { getSendLaneBusId } from './getSendLaneBusId';
import { type ActionPromptScope } from './promptScope';

export type AnchorTargetRules = NonNullable<ReturnType<typeof getExecutableAppActionGroundingRules>>['targetRules'];

/** The track a call acts on and every track its scope names beside it, when the scope names two or more. */
export function getAnchorReferences(
    actionScope: ActionPromptScope,
    targetRules: AnchorTargetRules,
    groundedArguments: Record<string, unknown>,
    context: ProjectContext
): { anchorId: string; references: readonly PromptReferenceSpan[] } | undefined {
    const anchorRule = targetRules.find(
        (targetRule) =>
            targetRule.promptRole !== 'destination' && typeof groundedArguments[targetRule.argument] === 'string'
    );
    const anchorId = anchorRule ? groundedArguments[anchorRule.argument] : undefined;
    if (typeof anchorId !== 'string' || !context.tracks.some((track) => track.id === anchorId)) {
        return undefined;
    }
    const otherTargetIds = new Set([
        ...targetRules
            .filter((targetRule) => targetRule !== anchorRule)
            .map((targetRule) => groundedArguments[targetRule.argument]),
        getSendLaneBusId(groundedArguments),
    ]);
    const references =
        actionScope.coordinatedTargets?.references ??
        getNamedReferenceSpans(
            actionScope.text,
            context.tracks.filter((track) => !otherTargetIds.has(track.id))
        );
    if (new Set(references.map((reference) => reference.id)).size < 2) {
        return undefined;
    }
    return { anchorId, references };
}
