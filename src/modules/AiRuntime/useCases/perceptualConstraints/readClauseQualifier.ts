import { type PerceptualConstraintScope } from '../../models/PerceptualConstraint';

import { EXCEPTION_AFTER, EXCEPTION_BEFORE, EXCEPTION_EDGE_MARKS, OBJECT_ONLY_ASIDE } from './constraintClauseWords';
import { type ConsumedSpan } from './readUnreadConstraintClauses';

const TRAILING_OBJECT_ASIDE = new RegExp(String.raw`^\s*${OBJECT_ONLY_ASIDE}`, 'iu');
const TRAILING_EXCEPTION = new RegExp(String.raw`^${EXCEPTION_AFTER}`, 'diu');
const LEADING_EXCEPTION = new RegExp(EXCEPTION_BEFORE, 'iu');

/** What a constraint's clause goes on to qualify it by, the span it is quoted with, and why it is unread. */
export type ClauseQualifier = { start: number; end: number; reason: string };

/**
 * The request a qualifier is read in: its masked text, its own words, and the tracks an object in it
 * names (null where it names no track).
 */
export type QualifiedText = {
    masked: string;
    prompt: string;
    trackIdsOf: (object: string) => readonly string[] | null;
};

/**
 * Whether an exception after a clause excepts part of the clause's own scope. An exception word always
 * does ("except the vocal", "unless the chorus needs it"). A permission or a leaving-out does unless its
 * object names only tracks outside the scope, which states the other scope's own change ("keep the vocal
 * bright, the drums can be louder"), not an exception to the hold. A refusal ("(not the vocal)") does
 * only when its object names a track inside the scope, since "not" may as well refuse a quality ("keep
 * the vocal bright, not harsh").
 */
function exceptsWithinScope(
    exception: RegExpExecArray,
    offset: number,
    text: QualifiedText,
    scope: PerceptualConstraintScope
): boolean {
    const captured = exception.indices?.groups;
    const objectSpan = captured?.refused ?? captured?.permitted ?? captured?.excepted;
    if (objectSpan === undefined) {
        return true;
    }
    const exceptedTrackIds = text.trackIdsOf(text.prompt.slice(offset + objectSpan[0], offset + objectSpan[1]));
    if (exceptedTrackIds === null) {
        return captured?.refused === undefined;
    }
    return scope.kind === 'mix' || exceptedTrackIds.some((trackId) => scope.trackIds.includes(trackId));
}

/** An exception's own words, without the marks that set it off from its clause. */
function trimExceptionMarks(exception: string): string {
    return exception.replaceAll(EXCEPTION_EDGE_MARKS, '').trim();
}

/**
 * What qualifies a constraint's clause so that no scope it names can be measured whole: an aside
 * naming only an object after it ("don't touch the low end (vocal)", "don't make it louder (the
 * vocal)"), which names an object beside the one the clause was read on, as "keep the vocal (lead)
 * bright" does, or an exception after or before it ("keep the mix from getting louder (except the
 * vocal)", "keep the mix level, vocal excepted", "except for the vocal, keep the mix level"), which
 * leaves part of its scope free while a measured bound or hold covers it all. An aside opening with
 * "of", "on" or "in" names the clause's own object and is read inside it ("keep the brightness (of the
 * vocal)").
 */
export function readClauseQualifier(
    text: QualifiedText,
    scope: PerceptualConstraintScope,
    span: ConsumedSpan
): ClauseQualifier | null {
    const { masked, prompt } = text;
    const after = masked.slice(span.end);
    const aside = TRAILING_OBJECT_ASIDE.exec(after);
    if (aside !== null) {
        const end = span.end + aside[0].length;
        const quoted = prompt.slice(span.end, end).trim();
        return {
            start: span.start,
            end,
            reason: `“${quoted}” names an object beside the one its clause holds, so no single scope can be measured.`,
        };
    }
    const trailing = TRAILING_EXCEPTION.exec(after);
    const exception = trailing !== null && exceptsWithinScope(trailing, span.end, text, scope) ? trailing : null;
    const before = exception === null ? LEADING_EXCEPTION.exec(masked.slice(0, span.start)) : null;
    if (exception === null && before === null) {
        return null;
    }
    const start = before === null ? span.start : before.index;
    const end = exception === null ? span.end : span.end + exception[0].length;
    const excepted = before === null ? prompt.slice(span.end, end) : prompt.slice(start, span.start);
    return {
        start,
        end,
        reason: `“${trimExceptionMarks(excepted)}” excepts part of what its clause holds, and a measured bound or hold covers its whole scope.`,
    };
}
