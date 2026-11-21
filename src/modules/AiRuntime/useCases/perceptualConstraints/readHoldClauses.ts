import {
    CLAUSE_END,
    CLAUSE_HEAD,
    MODAL_NEGATION,
    NEGATION,
    normalizeObjectText,
    OBJECT_LIST,
    QUALITY_VERBS,
    SCOPE_WORD,
} from './constraintClauseWords';
import {
    DIRECTION_LIST,
    directionConstraintIds,
    HOLD_NOUN_WORD,
    LOUDNESS_NOUN_WORD,
    type MeasuredConstraintId,
    NOUN_VERB,
    QUALITY_OF,
    QUALITY_VERB,
} from './constraintDirections';
import { nounConstraintId } from './nounConstraintId';

/**
 * One object's holds inside a clause: the holds it states, its object and where that object's words
 * begin. `unreadable` says why the part cannot be held on any one scope.
 */
export type HoldPart = {
    start: number;
    constraintIds: MeasuredConstraintId[];
    object: string | null;
    unreadable: string | null;
};
/** A clause a measured-hold reader consumed: its own words, the span it covers and its parts. */
export type HoldClause = { clause: string; start: number; end: number; parts: HoldPart[] };

const LIST_TAIL = String.raw`(?:\s+(?:of|on|in)\s+${OBJECT_LIST})?`;
/** "sound louder" is a louder clause: the linking verb is never part of the object. */
const DIRECTION_LEAD = String.raw`(?:(?:sound|feel|seem|get|become|be)\s+)?(?:any\s+)?`;
const HOLD_SUFFIX = String.raw`(?:\s+(?:the\s+same|unchanged|intact|as\s+(?:it\s+)?is|where\s+it\s+is))?`;
/** The objects a noun may carry before it, possessive or not: "the vocal level", "the vocal and drums level". */
const PRE_MEMBER = String.raw`(?:□+|(?:${SCOPE_WORD})\b)(?:['’]s?)?`;
const PRE_LIST = String.raw`${PRE_MEMBER}(?:\s+and\s+(?:the\s+)?${PRE_MEMBER})*`;
function holdNoun(word: string): string {
    return String.raw`(?:${PRE_LIST}\s+)?(?:(?:overall|stereo)\s+)?${word}\b`;
}
/** Nouns joined by "and" or commas share the clause's one object: "the width and dynamics of the vocal". */
function nounList(word: string): string {
    return String.raw`(?<nouns>the\s+${holdNoun(word)}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)(?:the\s+)?${holdNoun(word)})*)`;
}
const NOUN_IN_LIST = new RegExp(
    String.raw`(?:(?<pre>${PRE_LIST})\s+)?(?:(?:overall|stereo)\s+)?(?<noun>${HOLD_NOUN_WORD})\b`,
    'dgiu'
);
const DIRECTION_CLAUSE = String.raw`${DIRECTION_LEAD}${DIRECTION_LIST}${CLAUSE_END}`;
/** A later object under the same negation: "don't make the mix louder and the vocal quieter". */
const DIRECTION_CONTINUATION = new RegExp(String.raw`\s+and\s+(?!any\b)${OBJECT_LIST}\s+${DIRECTION_CLAUSE}`, 'dyiu');
/**
 * A later noun under the same verb: "keep the level of the vocal and the width of the drums". It
 * names no verb of its own, so it takes the verb of the clause it continues.
 */
const NOUN_CONTINUATION = new RegExp(
    String.raw`(?:\s*,\s*(?:and\s+)?|\s+and\s+)${nounList(HOLD_NOUN_WORD)}${LIST_TAIL}${HOLD_SUFFIX}${CLAUSE_END}`,
    'dyiu'
);

type HoldPattern = { pattern: RegExp; continuation: RegExp | null };

/**
 * Not after a negation earlier in the same clause ("you don't have to keep …", "there's no need to
 * prevent …"), which may permit the move a keep, stop or prevent … from names, so no bound is read.
 */
const NOT_AFTER_CLAUSE_NEGATION = String.raw`(?<!(?:\b(?:not|no|never|without)|n['’]t)\b(?:(?!\b(?:and|or|but|then)\b)[^,.;:!?])*)`;

function holdPattern(source: string, continuation: RegExp | null): HoldPattern {
    return { pattern: new RegExp(source, 'dgiu'), continuation };
}

/** In reading order: on one span the earlier pattern's reading stands. */
const HOLD_PATTERNS: readonly HoldPattern[] = [
    // "don't make it sound louder", "without making the drums any quieter", "don't make the mix any wider"
    holdPattern(
        String.raw`\b${NEGATION}\s+(?:make|making|get|getting|let|letting)(?:\s+(?!any\b)${OBJECT_LIST})?\s+${DIRECTION_CLAUSE}`,
        DIRECTION_CONTINUATION
    ),
    // "the mix must not get louder", "the mix isn't louder"
    holdPattern(
        String.raw`${CLAUSE_HEAD}${OBJECT_LIST}\s+${MODAL_NEGATION}\s+${DIRECTION_CLAUSE}`,
        DIRECTION_CONTINUATION
    ),
    // "don't raise the level of the drums", "don't change the drums volume", "don't widen the stereo image"
    holdPattern(
        String.raw`\b${NEGATION}\s+${NOUN_VERB}\s+${nounList(HOLD_NOUN_WORD)}${LIST_TAIL}${CLAUSE_END}`,
        NOUN_CONTINUATION
    ),
    // "don't turn the level of the vocal up"
    holdPattern(
        String.raw`\b${NEGATION}\s+(?<verb>turn(?:ing)?)\s+${nounList(HOLD_NOUN_WORD)}${LIST_TAIL}\s+(?<particle>up|down)${CLAUSE_END}`,
        null
    ),
    // "don't widen the drums", "without squashing the mix"
    holdPattern(String.raw`\b${NEGATION}\s+${QUALITY_VERB}(?:\s+(?!any\b)${OBJECT_LIST})?${CLAUSE_END}`, null),
    // "keep the mix from getting louder"; "don't stop the mix from getting wider" permits the move
    holdPattern(
        String.raw`${NOT_AFTER_CLAUSE_NEGATION}(?<permitted>\b${NEGATION}\s+)?\b(?:keep|keeping|stop|stopping|prevent|preventing)\s+${OBJECT_LIST}\s+from\s+(?:(?:getting|becoming|sounding|being)\s+)?(?:any\s+)?${DIRECTION_LIST}${CLAUSE_END}`,
        null
    ),
    // "keep the overall level the same", "keep the width and dynamics of the vocal", "keep the stereo width"
    holdPattern(
        String.raw`\b${QUALITY_VERBS}\s+${nounList(HOLD_NOUN_WORD)}${LIST_TAIL}${HOLD_SUFFIX}${CLAUSE_END}`,
        NOUN_CONTINUATION
    ),
    // "keep the Keys at the same level"
    holdPattern(
        String.raw`\b(?:keep|keeping)\s+${OBJECT_LIST}\s+at\s+the\s+same\s+${LOUDNESS_NOUN_WORD}${CLAUSE_END}`,
        null
    ),
];
/**
 * A character of a fallback object: it never crosses a conjunction, a negation or a "please" into the
 * next clause. Those and punctuation are every boundary a readable clause opens or ends at.
 */
const IN_CLAUSE = String.raw`(?:(?!\b(?:and|or|but|while|so|then|please)\b|\b${NEGATION})[^,.;:!?])`;
/**
 * A direction clause whose object is no list the reader can read ("don't make the cello part
 * louder"): recorded unsupported rather than held on a guessed scope or dropped.
 */
const UNREADABLE_DIRECTION = new RegExp(
    String.raw`\b${NEGATION}\s+(?:make|making|get|getting|let|letting)\s+(?<object>${IN_CLAUSE}+?(?:\s+(?:and|or))?)\s+${DIRECTION_CLAUSE}`,
    'dgiu'
);

function spanText(prompt: string, span: [number, number] | undefined): string | null {
    return span === undefined ? null : prompt.slice(span[0], span[1]);
}

/** The clause's verb, its split particle joined back on: "turn … up" reads as "turn up". */
function verbOf(match: RegExpExecArray): string | undefined {
    const verb = match.groups?.verb;
    const particle = match.groups?.particle;
    if (verb === undefined || particle === undefined) {
        return verb;
    }
    return `${verb} ${particle}`;
}

/** Each held noun the clause's noun list names, with the object word standing before it. */
function nounsOf(match: RegExpExecArray): RegExpExecArray[] {
    return Array.from((match.groups?.nouns ?? '').matchAll(NOUN_IN_LIST));
}

/** Each noun's family under the clause's verb, once each, in the order the nouns name them. */
function nounConstraintIds(nouns: readonly RegExpExecArray[], verb: string | undefined): MeasuredConstraintId[] {
    const ids = nouns.flatMap((noun) => nounConstraintId(noun.groups?.noun ?? '', verb) ?? []);
    return ids.filter((id, index) => ids.indexOf(id) === index);
}

/** An object word standing before one noun of the list, read from the prompt by the list's offsets. */
function preObjectOf(noun: RegExpExecArray, nounsStart: number, prompt: string): string | null {
    const preSpan = noun.indices?.groups?.pre;
    if (preSpan === undefined) {
        return null;
    }
    return prompt.slice(nounsStart + preSpan[0], nounsStart + preSpan[1]);
}

/** Every distinct object the clause names: the "of" tail first, then each object before a noun. */
function nounObjects(match: RegExpExecArray, nouns: readonly RegExpExecArray[], prompt: string): string[] {
    const objects = new Map<string, string>();
    const tail = spanText(prompt, match.indices?.groups?.object);
    if (tail !== null) {
        objects.set(normalizeObjectText(tail), tail);
    }
    const nounsStart = match.indices?.groups?.nouns?.[0];
    if (nounsStart === undefined) {
        return Array.from(objects.values());
    }
    for (const noun of nouns) {
        const pre = preObjectOf(noun, nounsStart, prompt);
        if (pre !== null) {
            objects.set(normalizeObjectText(pre), pre);
        }
    }
    return Array.from(objects.values());
}

/**
 * Each noun's family, and the part's one object: the "of" tail or an object standing before a noun.
 * Two different objects in one part hold no single scope, so the part is unreadable.
 */
function readNounPart(
    match: RegExpExecArray,
    verb: string | undefined,
    prompt: string,
    clause: () => string
): HoldPart {
    const nouns = nounsOf(match);
    const [object = null, ...others] = nounObjects(match, nouns, prompt);
    return {
        start: match.index,
        constraintIds: nounConstraintIds(nouns, verb),
        object,
        unreadable: others.length > 0 ? `“${clause()}” names more than one scope for one hold.` : null,
    };
}

/**
 * The holds a direction clause states. A negated stop, prevent or keep … from permits the move it
 * names, so it states none, though its words stay consumed and no other reader reads them.
 */
function directionPartIds(match: RegExpExecArray): MeasuredConstraintId[] {
    if (match.groups?.permitted !== undefined) {
        return [];
    }
    const direction = match.groups?.direction;
    return direction === undefined ? ['loudness-held-v1'] : directionConstraintIds(direction);
}

function readPart(match: RegExpExecArray, verb: string | undefined, prompt: string, clause: () => string): HoldPart {
    if (match.groups?.nouns !== undefined) {
        return readNounPart(match, verb, prompt, clause);
    }
    return {
        start: match.index,
        constraintIds: directionPartIds(match),
        object: spanText(prompt, match.indices?.groups?.object),
        unreadable: null,
    };
}

/** The match and every continuation that follows it under the same verb or negation. */
function withContinuations(match: RegExpExecArray, continuation: RegExp | null, masked: string): RegExpExecArray[] {
    const matches = [match];
    let end = match.index + match[0].length;
    while (continuation !== null) {
        continuation.lastIndex = end;
        const next = continuation.exec(masked);
        if (next === null) {
            break;
        }
        matches.push(next);
        end = next.index + next[0].length;
    }
    return matches;
}

/**
 * Every part reads under the opening match's verb, which a continuation never restates. A
 * continuation with no object of its own shares the object before it ("the level and, the width").
 */
function readHoldMatch(matches: readonly RegExpExecArray[], prompt: string): HoldClause {
    const [first] = matches;
    const last = matches.at(-1);
    const start = first?.index ?? 0;
    const end = last === undefined ? start : last.index + last[0].length;
    const clause = prompt.slice(start, end).trim();
    const verb = first === undefined ? undefined : verbOf(first);
    const parts: HoldPart[] = [];
    for (const match of matches) {
        const part = readPart(match, verb, prompt, () => clause);
        const inherited = parts.at(-1);
        parts.push(part.object === null && inherited !== undefined ? { ...part, object: inherited.object } : part);
    }
    return { clause, start, end, parts };
}

function readUnreadableDirection(match: RegExpExecArray, prompt: string): HoldClause {
    const hold = readHoldMatch([match], prompt);
    const object = spanText(prompt, match.indices?.groups?.object) ?? '';
    return {
        ...hold,
        parts: hold.parts.map((part) => {
            const qualities = Array.from(new Set(part.constraintIds.map((id) => QUALITY_OF[id]))).join(' and ');
            return { ...part, unreadable: `“${object}” names no track or mix whose ${qualities} can be measured.` };
        }),
    };
}

/** Every measured-hold clause in the order it appears, never two over one span, a readable one first. */
export function readHoldClauses(masked: string, prompt: string): HoldClause[] {
    const readable = HOLD_PATTERNS.flatMap(({ pattern, continuation }) =>
        Array.from(masked.matchAll(pattern), (match) =>
            readHoldMatch(withContinuations(match, continuation, masked), prompt)
        )
    );
    const unreadable = Array.from(masked.matchAll(UNREADABLE_DIRECTION), (match) =>
        readUnreadableDirection(match, prompt)
    );
    // No readable clause opens or ends inside a fallback object, so the two overlap only by sharing a
    // start, where the stable sort keeps the readable clause, which comes first.
    const clauses = readable.concat(unreadable).toSorted((left, right) => left.start - right.start);
    return clauses.filter(
        (clause, index) =>
            !clauses.slice(0, index).some((other) => other.start < clause.end && clause.start < other.end)
    );
}
