import { type ProjectContext } from '../../../models/ProjectContext';

import { getNamedReferenceSpans } from './getNamedReferenceSpans';
import { isLevelContinuationClause } from './isLevelContinuationClause';
import { type ActionPromptScope, type PromptClause } from './promptScope';

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
