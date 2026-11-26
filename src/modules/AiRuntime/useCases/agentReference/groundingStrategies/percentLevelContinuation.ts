import { type getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';
import { blankRanges } from '../blankRanges';
import { bindDecibelFiguresToReferences, type PromptReferenceSpan } from './bindDecibelFiguresToReferences';
import { findPromptNumbers } from './findPromptNumbers';
import { getNamedReferenceSpans } from './getNamedReferenceSpans';
import { getSendLaneBusId } from './getSendLaneBusId';
import { getStatedDecibelLevelForms } from './getStatedDecibelLevelForms';
import { type ActionPromptScope, type PromptClause } from './promptScope';

type TargetRules = NonNullable<ReturnType<typeof getExecutableAppActionGroundingRules>>['targetRules'];

/**
 * A clause that only adds one more reference and its decibel figure to the level change before it:
 * "and the Snare at -9 dB". The figure's connector states its form, and the action must declare it.
 */
export function isLevelContinuationClause(
    maskedClause: string,
    decibelLevelForms: readonly ('absolute-decibel' | 'relative-decibel')[]
): boolean {
    if (
        !/^\s*(?:(?:the|a|an)\s+)?(?:clip)?□+\s+(?:at|to|by|up|down)\s+[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*d\s?b\s*$/iu.test(
            maskedClause
        )
    ) {
        return false;
    }
    const statedLevelForms = getStatedDecibelLevelForms(maskedClause);
    return decibelLevelForms.some((form) => statedLevelForms.has(form));
}

/**
 * Whether the clause continues a level the scope before it states in percent onto another track:
 * "Drums to 60%" after "set Vocals volume to 75%". The reference must be a track's whole name, so a
 * device's level ("Reverb to 30%") is never read as another track's fader.
 */
function isPercentLevelContinuationClause(
    clause: PromptClause,
    previousScope: ActionPromptScope | undefined,
    context: ProjectContext
): boolean {
    if (previousScope === undefined || !/\d%/u.test(previousScope.masked)) {
        return false;
    }
    const continuation = /^(\s*(?:(?:the|a|an)\s+)?)(□+)\s+(?:at|to)\s+(?:\d+(?:\.\d+)?|\.\d+)\s*%\s*$/iu.exec(
        clause.masked
    );
    const [, lead, reference] = continuation ?? [];
    if (continuation === null || lead === undefined || reference === undefined) {
        return false;
    }
    const start = continuation.index + lead.length;
    const end = start + reference.length;
    return getNamedReferenceSpans(clause.text, context.tracks).some((span) => span.start === start && span.end === end);
}

/** Whether the clause continues the level change before it in decibels or in percent onto another track. */
export function continuesLevelChange(
    clause: PromptClause,
    decibelLevelForms: readonly ('absolute-decibel' | 'relative-decibel')[],
    previousScope: ActionPromptScope | undefined,
    context: ProjectContext
): boolean {
    return (
        isLevelContinuationClause(clause.masked, decibelLevelForms) ||
        isPercentLevelContinuationClause(clause, previousScope, context)
    );
}

/** The track a call acts on and every track its scope names beside it, when the scope names two or more. */
export function getAnchorReferences(
    actionScope: ActionPromptScope,
    targetRules: TargetRules,
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
    targetRules: TargetRules,
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
