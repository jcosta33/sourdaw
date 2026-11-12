import { resolveMusicalRange } from '#/modules/Arrangement/useCases';
import { getBarStartBeat } from '#/modules/Transport/useCases';
import { isRecord } from '#/utils/structuralEquality';

import { type ProjectContext } from '../../../models/ProjectContext';

import { LOUDER_SCOPE_PHRASES, QUIETER_SCOPE_PHRASES } from './classifyPromptDecibelFigures';
import { escapeRegExp } from './escapeRegExp';
import { maskProjectReferences } from './maskProjectReferences';

type StatedRange = Parameters<typeof resolveMusicalRange>[0]['range'];

/** The beats a range covers once the project resolves it. */
export type RangeBeats = { startBeat: number; endBeat: number };

/** One range phrase a request states: where it sits in the text and the beats it names. */
export type RangePhrase = RangeBeats & { start: number; end: number };

/** Punctuation and spacing a range phrase may close on. */
const CLOSING = String.raw`[\p{P}\s]*$`;

const NUMBER = String.raw`\d+(?:\.\d+)?`;

const SECTION_CONNECTOR_PATTERN = /(?<=^|\s)(?:in|during)\s+/giu;

const BAR_RANGE_PATTERN = new RegExp(
    String.raw`(?<=^|\s)(?:over|across|in|from|during)\s+bars?\s+(?<start>\d+)\s*(?:to|through|-|–)\s*(?:bar\s+)?(?<end>\d+)`,
    'giu'
);

const BEAT_RANGE_PATTERN = new RegExp(
    String.raw`(?<=^|\s)(?:over|across|from)\s+beats?\s+(?<start>${NUMBER})\s*(?:to|through|-|–)\s*(?:beat\s+)?(?<end>${NUMBER})`,
    'giu'
);

const TRAILING_PUNCTUATION_PATTERN = new RegExp(CLOSING, 'u');

const ONLY_CLOSING_PATTERN = new RegExp(`^${CLOSING}`, 'u');

/**
 * Whether the text after a range phrase only finishes the range change: the decibel figure a
 * request may state after its range ("in Chorus Two by 1.5 dB"), a ramp the range draws with
 * ("with 0.5 beat ramps in and out", ", ramping in and out over one beat"), and closing punctuation.
 * Anything else ("but not in the first half", "except the last bar") may narrow the range, which
 * one range write cannot honour.
 */
const RANGE_TAIL_PATTERN = new RegExp(
    [
        '^',
        String.raw`(?:\s+(?:by|to|at)\s+[-+−–]?(?:${NUMBER}|\.\d+)\s*d\s?b)?`,
        String.raw`(?:\s*,?\s*(?:ramping\s+(?:in\s+and\s+out|in|out)\s+over\s+(?:${NUMBER}|one|a|half\s+a)\s+beats?|with\s+(?:${NUMBER}|one|a|half\s+a)[\s-]*beats?\s+ramps?(?:\s+in\s+and\s+out|\s+in|\s+out)?))?`,
        CLOSING,
    ].join(''),
    'iu'
);

/** The glyph a masked project reference is written in; `maskProjectReferences.ts` owns it. */
const MASKED_REFERENCE = '□+';

const DETERMINER = '(?:the|every|all|each|both)';

/** The track controls a range write names beside its track: "the Vocals pan", "the Lead Vocal send". */
const CONTROL_WORD = '(?:send|sends|pan|gain|level|volume|fader)';

/** The bus a send ride names: "to the Hall", "from Lead Vocal to Hall". */
const SEND_ROUTE = String.raw`(?:from\s+${MASKED_REFERENCE}\s+)?to\s+(?:the\s+)?${MASKED_REFERENCE}`;

/** The one target the write holds: a decibel figure, a value in the lane's units, or a pan side. */
const TARGET_FIGURE = String.raw`(?:(?:by|to|at|down|up)\s+[-+−–]?(?:${NUMBER}|\.\d+)(?:\s*(?:d\s?b|decibels?))?|to\s+the\s+(?:left|right|centre|center))`;

function alternation(phrases: Iterable<string>): string {
    const unique = [...new Set([...phrases].map((phrase) => phrase.trim().toLowerCase()).filter(Boolean))];
    return unique
        .sort((left, right) => right.length - left.length)
        .map((phrase) => escapeRegExp(phrase).replace(/\s+/gu, String.raw`\s+`))
        .join('|');
}

/** The words of the project's own device names, which a request may name a device parameter by. */
function getDeviceNameWords(context: ProjectContext): string[] {
    return context.tracks.flatMap((track) =>
        track.devices.flatMap((device) =>
            (device.name ?? '').split(/\s+/u).filter((word) => /^[\p{L}\p{N}]+$/u.test(word))
        )
    );
}

/**
 * The closed reading of what a request states before its range phrase: the action's own verb, the
 * targets it names (masked project references, listed with "and" or commas, a device named between
 * a track and its parameter), the control and send route it rides, one target figure, and "only".
 * Nothing else may stand there, so wording that turns the range into the part the change leaves
 * alone — "everywhere but in Chorus Two", "aside from Chorus Two", "outside Chorus Two" — reads as
 * no range at all, whichever words it uses.
 */
function compileActionClausePattern(actionPhrases: readonly string[], context: ProjectContext): RegExp {
    const verbs = alternation([...actionPhrases, ...QUIETER_SCOPE_PHRASES, ...LOUDER_SCOPE_PHRASES]);
    const deviceWords = alternation(getDeviceNameWords(context));
    const item =
        deviceWords.length > 0
            ? String.raw`${MASKED_REFERENCE}(?:\s+(?:${deviceWords})(?:\s+${MASKED_REFERENCE})?)?`
            : MASKED_REFERENCE;
    const targets = String.raw`(?:${DETERMINER}\s+)?${item}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)(?:${DETERMINER}\s+)?${item})*`;
    return new RegExp(
        [
            String.raw`^\s*(?:${verbs})`,
            String.raw`(?:\s+${targets})?`,
            String.raw`(?:\s+${CONTROL_WORD})?`,
            String.raw`(?:\s+${SEND_ROUTE})?`,
            String.raw`(?:\s+${TARGET_FIGURE})?`,
            String.raw`(?:\s+(?:only|just))?`,
            String.raw`[\s,]*$`,
        ].join(''),
        'iu'
    );
}

type RangeResolution = ReturnType<typeof resolveMusicalRange>;

function resolve(range: StatedRange, context: ProjectContext): RangeResolution {
    return resolveMusicalRange({
        range,
        sections: context.sections ?? [],
        markers: context.markers ?? [],
        tracks: context.tracks,
        barStartBeat: getBarStartBeat,
    });
}

function resolveBeats(range: StatedRange, context: ProjectContext): RangeBeats | null {
    const resolution = resolve(range, context);
    return resolution.kind === 'resolved' ? { startBeat: resolution.startBeat, endBeat: resolution.endBeat } : null;
}

function findNumericRanges(
    text: string,
    pattern: RegExp,
    toRange: (start: number, end: number) => StatedRange,
    context: ProjectContext
): RangePhrase[] {
    return [...text.matchAll(pattern)].flatMap((match) => {
        const beats = resolveBeats(toRange(Number(match.groups?.start), Number(match.groups?.end)), context);
        return beats === null ? [] : [{ ...beats, start: match.index, end: match.index + match[0].length }];
    });
}

/** The section references a reference may be, longest first: each whole-word prefix of the text. */
function getReferenceCandidates(remainder: string): string[] {
    const wordEnds = [...remainder.matchAll(/\S+/gu)].map((word) => word.index + word[0].length);
    return wordEnds.reverse().flatMap((end) => {
        const candidate = remainder.slice(0, end);
        const unpunctuated = candidate.replace(TRAILING_PUNCTUATION_PATTERN, '');
        return unpunctuated === candidate || unpunctuated.length === 0 ? [candidate] : [candidate, unpunctuated];
    });
}

/** Each `in <reference>` whose longest whole-word reference names a place the project resolves. */
function findSectionRanges(text: string, context: ProjectContext): RangePhrase[] {
    return [...text.matchAll(SECTION_CONNECTOR_PATTERN)].flatMap((match) => {
        const referenceStart = match.index + match[0].length;
        for (const reference of getReferenceCandidates(text.slice(referenceStart))) {
            const beats = resolveBeats({ section: reference }, context);
            if (beats !== null) {
                return [{ ...beats, start: match.index, end: referenceStart + reference.length }];
            }
        }
        return [];
    });
}

/**
 * Every range phrase `text` states, in text order: `in <section>` naming a place the musical range
 * resolver finds, `over bars N to M`, or `over beats N to M` (`from beat N to beat M` alike). The
 * resolver decides what counts as a place, so a phrase names a range only when a range write would
 * resolve it. A section connector the bar form already read is not read again.
 */
export function findRangePhrases(text: string, context: ProjectContext): RangePhrase[] {
    const numeric = [
        ...findNumericRanges(text, BAR_RANGE_PATTERN, (startBar, endBar) => ({ startBar, endBar }), context),
        ...findNumericRanges(text, BEAT_RANGE_PATTERN, (startBeat, endBeat) => ({ startBeat, endBeat }), context),
    ];
    const sections = findSectionRanges(text, context).filter(
        (section) => !numeric.some((phrase) => phrase.start === section.start)
    );
    return [...numeric, ...sections].sort((left, right) => left.start - right.start);
}

/** Where a closing range phrase starts in `text`, or null when the text does not end on one. */
export function findTrailingRangePhrase(text: string, context: ProjectContext): number | null {
    const trailing = findRangePhrases(text, context).find((phrase) =>
        ONLY_CLOSING_PATTERN.test(text.slice(phrase.end))
    );
    return trailing?.start ?? null;
}

/**
 * The beats the one range phrase `text` states, or null when it states none, several, anything
 * after it but a figure, a ramp and closing punctuation, or anything before it but the action clause
 * `actionPhrases` opens.
 */
export function readStatedRangeBeats(
    text: string,
    context: ProjectContext,
    actionPhrases: readonly string[]
): RangeBeats | null {
    const phrases = findRangePhrases(text, context);
    if (phrases.length !== 1) {
        return null;
    }
    const [phrase] = phrases;
    const actionClause = maskProjectReferences(text, context).slice(0, phrase!.start);
    if (!compileActionClausePattern(actionPhrases, context).test(actionClause)) {
        return null;
    }
    return RANGE_TAIL_PATTERN.test(text.slice(phrase!.end)) ? phrase! : null;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
}

/** How the project resolves a call's own range argument, or null when it is no range object. */
export function resolveCallRange(range: unknown, context: ProjectContext): RangeResolution | null {
    if (!isRecord(range)) {
        return null;
    }
    return resolve(
        {
            section: typeof range.section === 'string' ? range.section : undefined,
            startBar: readNumber(range.startBar),
            endBar: readNumber(range.endBar),
            startBeat: readNumber(range.startBeat),
            endBeat: readNumber(range.endBeat),
        },
        context
    );
}
