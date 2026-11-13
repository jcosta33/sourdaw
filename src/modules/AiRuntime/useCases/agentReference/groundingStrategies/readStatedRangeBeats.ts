import { type ProjectContext } from '../../../models/ProjectContext';

import { LOUDER_SCOPE_PHRASES, QUIETER_SCOPE_PHRASES } from './classifyPromptDecibelFigures';
import { escapeRegExp } from './escapeRegExp';
import { findRangePhrases, RANGE_CLOSING, RANGE_NUMBER, type RangeBeats } from './findRangePhrases';
import { maskProjectReferences } from './maskProjectReferences';

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
        String.raw`(?:\s+(?:by|to|at)\s+[-+−–]?(?:${RANGE_NUMBER}|\.\d+)\s*d\s?b)?`,
        String.raw`(?:\s*,?\s*(?:ramping\s+(?:in\s+and\s+out|in|out)\s+over\s+(?:${RANGE_NUMBER}|one|a|half\s+a)\s+beats?|with\s+(?:${RANGE_NUMBER}|one|a|half\s+a)[\s-]*beats?\s+ramps?(?:\s+in\s+and\s+out|\s+in|\s+out)?))?`,
        RANGE_CLOSING,
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
const TARGET_FIGURE = String.raw`(?:(?:by|to|at|down|up)\s+[-+−–]?(?:${RANGE_NUMBER}|\.\d+)(?:\s*(?:d\s?b|decibels?))?|to\s+the\s+(?:left|right|centre|center))`;

function alternation(phrases: readonly string[]): string {
    const unique = new Set(phrases.map((phrase) => phrase.trim().toLowerCase()).filter(Boolean));
    return Array.from(unique)
        .sort((left, right) => right.length - left.length)
        .map((phrase) => escapeRegExp(phrase).replaceAll(/\s+/gu, String.raw`\s+`))
        .join('|');
}

/** One target: a masked reference, or a device named by its project name between a track and its parameter. */
function getTargetItemPattern(deviceWords: string): string {
    if (deviceWords.length === 0) {
        return MASKED_REFERENCE;
    }
    return String.raw`${MASKED_REFERENCE}(?:\s+(?:${deviceWords})(?:\s+${MASKED_REFERENCE})?)?`;
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
function actionClausePattern(actionPhrases: readonly string[], context: ProjectContext): RegExp {
    const verbs = alternation([...actionPhrases, ...QUIETER_SCOPE_PHRASES, ...LOUDER_SCOPE_PHRASES]);
    const item = getTargetItemPattern(alternation(getDeviceNameWords(context)));
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
    if (!actionClausePattern(actionPhrases, context).test(actionClause)) {
        return null;
    }
    return RANGE_TAIL_PATTERN.test(text.slice(phrase!.end)) ? phrase! : null;
}
