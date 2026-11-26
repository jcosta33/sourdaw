import { type ProjectContext } from '../../../models/ProjectContext';
import { blankRanges } from '../blankRanges';

import { bindDecibelFiguresToReferences, type PromptReferenceSpan } from './bindDecibelFiguresToReferences';
import { findPromptNumbers } from './findPromptNumbers';
import { type AnchorTargetRules, getAnchorReferences } from './getAnchorReferences';
import { type ActionPromptScope } from './promptScope';

/**
 * The figures a scope gives the call's own track. In a scope that took in continuation clauses each
 * clause states its own track's figures, wherever they stand in it ("set the volume to 75% on Vocals,
 * Drums to 60%"), so the anchor reads the figures up to the end of the one clause naming it. Figures of
 * an earlier clause stay readable here: a continuation clause states its figure after its own track,
 * so the figures bound to the nearest track before them already keep that track to its own.
 * Otherwise a figure binds to the nearest track named before it.
 */
function getAnchorNumbers<Figure extends { index: number }>(
    actionScope: ActionPromptScope,
    anchored: { anchorId: string; references: readonly PromptReferenceSpan[] },
    numbers: readonly Figure[]
): readonly Figure[] {
    if (actionScope.continuationStarts === undefined) {
        return (
            bindDecibelFiguresToReferences(actionScope.text, anchored.references, numbers).get(anchored.anchorId) ?? []
        );
    }
    const starts = [0, ...actionScope.continuationStarts];
    const clauses = starts.map((start, index) => ({ start, end: starts[index + 1] ?? actionScope.text.length }));
    const anchorClauses = clauses.filter((clause) =>
        anchored.references.some(
            (reference) =>
                reference.id === anchored.anchorId && reference.start >= clause.start && reference.end <= clause.end
        )
    );
    const anchorClause = anchorClauses[0];
    if (anchorClauses.length !== 1 || anchorClause === undefined) {
        return [];
    }
    return numbers.filter((number) => number.index < anchorClause.end);
}

/**
 * The scope a call's values are read from: where the scope names several tracks and gives the call's
 * own track a figure, the figures it gives the others are blanked, so in "set Vocals volume to 75%,
 * Drums to 60%" the Drums call reads 60% and never the 75% the request gives Vocals.
 */
export function getAnchorValueScope(
    actionScope: ActionPromptScope,
    targetRules: AnchorTargetRules,
    groundedArguments: Record<string, unknown>,
    context: ProjectContext
): ActionPromptScope {
    const anchored = getAnchorReferences(actionScope, targetRules, groundedArguments, context);
    if (anchored === undefined) {
        return actionScope;
    }
    const numbers = findPromptNumbers(actionScope.masked);
    const anchorNumbers = getAnchorNumbers(actionScope, anchored, numbers);
    if (anchorNumbers.length === 0) {
        return actionScope;
    }
    const otherNumbers = numbers.filter((number) => !anchorNumbers.includes(number));
    const otherRanges = otherNumbers.map((number) => ({ start: number.index, end: number.end }));
    const masked = blankRanges(actionScope.masked, otherRanges, ' ');
    return { ...actionScope, masked };
}
