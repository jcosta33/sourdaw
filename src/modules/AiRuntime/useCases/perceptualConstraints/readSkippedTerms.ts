import { JOINED_CLAUSE_END, LIST_JOIN } from './constraintClauseWords';
import { UNMEASURED_COMPARATIVE } from './constraintDirections';

/**
 * The list members naming no measured quality that end a direction list, after the directions it
 * bounds: the "or harsher" of "without making it louder or harsher", which bounds nothing measured.
 */
export const UNMEASURED_MEMBERS = String.raw`(?:${LIST_JOIN}${UNMEASURED_COMPARATIVE})+(?=${JOINED_CLAUSE_END})`;
/** The same members, captured as `skipped` where a keep's move list ends on them: "from getting louder or harsher". */
export const UNMEASURED_MEMBER_TAIL = String.raw`(?<skipped>${UNMEASURED_MEMBERS})`;
const SKIPPED_TERM = new RegExp(String.raw`${LIST_JOIN}(${UNMEASURED_COMPARATIVE})`, 'giu');

/** Why the unmeasured members a list ended on hold nothing: "or harsher" names "harsher", which nothing measures. */
export function describeSkippedMembers(tail: string): string {
    const terms = Array.from(tail.matchAll(SKIPPED_TERM), (term) => `“${term[1] ?? ''}”`);
    return `No measurement the application takes shows that ${terms.join(' and ')} holds.`;
}
