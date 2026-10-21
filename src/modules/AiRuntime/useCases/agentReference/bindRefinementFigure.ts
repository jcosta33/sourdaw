import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalGroundingCommand } from '../../models/ProposalGroundingBasis';

import { LOUDER_SCOPE_PHRASES, QUIETER_SCOPE_PHRASES } from './groundingStrategies/classifyPromptDecibelFigures';
import { findPromptNumbers } from './groundingStrategies/findPromptNumbers';
import { normalizePromptText } from './groundingStrategies/normalizePromptText';
import { parsePromptNumberValue } from './groundingStrategies/parsePromptNumberValue';
import { type PromptClause } from './groundingStrategies/promptScope';

export type RefinementClause = PromptClause & { start: number; end: number };

/**
 * The value one refinement clause binds to one pending command. `expected` is the figure the clause
 * stated, signed and in the command's native form, when the clause's own wording would not say it;
 * `null` lets the clause's wording decide, read by the same value rules as any request.
 */
export type BoundRefinementValue = {
    clause: RefinementClause;
    argument: string;
    expected: number | null;
    /** Set when the clause kept the pending command's direction because it stated none of its own. */
    keptPendingDirection: boolean;
};

type PendingCommandView = { index: number; command: ProposalGroundingCommand };

type FigureRead =
    | { kind: 'restated' }
    | { kind: 'addition' }
    | { kind: 'value'; index: number; value: BoundRefinementValue }
    | { kind: 'clarify'; question: string }
    | { kind: 'refused'; reason: string };

type StatedFigure = {
    magnitude: number;
    sign: -1 | 1 | null;
    raw: string;
    unit: 'dB' | '%' | 'other' | null;
    connector: 'absolute' | 'relative' | null;
    direction: -1 | 1 | null | 'conflicting';
    /** The words beside the figure, read from the clause with every object name masked. */
    words: string;
};

type ValueResolution =
    | { status: 'bound'; argument: string; expected: number | null; keptPendingDirection: boolean }
    | { status: 'clarify'; question: string }
    | { status: 'refused'; reason: string };

type MoveDirection = { status: 'direction'; sign: -1 | 1; kept: boolean } | { status: 'clarify'; question: string };

const PAN_SIDE_WORDS: ReadonlySet<string> = new Set(['left', 'right']);
/** Words a pan clause reads itself: the operation and the side it lands on. */
const PAN_WORDS: ReadonlySet<string> = new Set(['pan', 'panning', ...PAN_SIDE_WORDS]);
/**
 * A sign spoken or typeset before the figure, touching it or a space away: "minus 1.5 dB", and any
 * dash or minus character — "-", "–" (U+2013), "‑" (U+2011), "−" (U+2212) — as in "by – 1.5 dB".
 */
const SIGN_MARK = /(?:\b(minus|plus)\s+|([\p{Pd}−])\s*)$/iu;
/**
 * Words that state a change relative to the value as it stands, which a plain value cannot move by:
 * "10% more", "decrease it 10%". A plain value only lands where it says, so such a clause is asked.
 */
const RELATIVE_WORDS: ReadonlySet<string> = new Set(['bigger', 'decrease', 'increase', 'less', 'more', 'smaller']);
/**
 * Words that state no direction, so a clause made only of them, its figure, unit and connector keeps
 * the pending change's direction. Any other word may be a direction this reading cannot tell ("bump",
 * "nudge"), and is asked rather than read as the pending one.
 */
const DIRECTIONLESS_WORDS: ReadonlySet<string> = new Set([
    'a',
    'actually',
    'also',
    'an',
    'and',
    'at',
    'but',
    'by',
    'change',
    'd',
    'db',
    'decibel',
    'decibels',
    'do',
    'fader',
    'gain',
    'go',
    'instead',
    'it',
    'its',
    'just',
    'level',
    'make',
    'now',
    'ok',
    'okay',
    'one',
    'please',
    'rather',
    'set',
    'so',
    'that',
    'the',
    'them',
    'then',
    'this',
    'to',
    'track',
    'value',
    'volume',
]);

function readUnit(raw: string, after: string): StatedFigure['unit'] {
    if (raw.endsWith('%')) {
        return '%';
    }
    if (/^\s*(?:d\s?b|decibels?)(?![\p{L}\p{N}])/iu.test(after)) {
        return 'dB';
    }
    if (/^\s*(?:k?hz|ms|s|sec|seconds?|beats?|bars?|semitones?|cents?)(?![\p{L}\p{N}])/iu.test(after)) {
        return 'other';
    }
    return null;
}

function readConnector(before: string): StatedFigure['connector'] {
    if (/\b(?:at|to)\s*$/iu.test(before)) {
        return 'absolute';
    }
    if (/\bby\s*$/iu.test(before)) {
        return 'relative';
    }
    return null;
}

function namesPhrase(words: string, phrase: string): boolean {
    return ` ${words} `.includes(` ${phrase} `);
}

/**
 * Which way the words beside the figure move a level, read by the scope phrases any level request is
 * read by, plus the `up` and `down` a figure may follow.
 */
function readDirection(words: string): StatedFigure['direction'] {
    const lowers = [...QUIETER_SCOPE_PHRASES, 'down'].some((phrase) => namesPhrase(words, phrase));
    const raises = [...LOUDER_SCOPE_PHRASES, 'up'].some((phrase) => namesPhrase(words, phrase));
    if (lowers && raises) {
        return 'conflicting';
    }
    if (lowers) {
        return -1;
    }
    return raises ? 1 : null;
}

/** The first word beside the figure not known to state no direction: it may state one this reading cannot tell. */
function findUnreadWord(words: string, alsoRead: ReadonlySet<string> = new Set()): string | null {
    return (
        words
            .split(' ')
            .find(
                (word) =>
                    word.length > 0 && !/^\p{N}+$/u.test(word) && !DIRECTIONLESS_WORDS.has(word) && !alsoRead.has(word)
            ) ?? null
    );
}

function statesWord(words: string, vocabulary: ReadonlySet<string>): boolean {
    return words.split(' ').some((word) => vocabulary.has(word));
}

/** The one figure a clause states, with its unit, connector and direction, read from the masked clause. */
function readFigure(clause: RefinementClause): StatedFigure | 'none' | 'several' | 'unreadable' {
    const numbers = findPromptNumbers(clause.masked);
    const [number] = numbers;
    if (number === undefined) {
        return 'none';
    }
    if (numbers.length > 1) {
        return 'several';
    }
    const value = parsePromptNumberValue(number.raw.endsWith('%') ? number.raw.slice(0, -1) : number.raw);
    if (value === null) {
        return 'unreadable';
    }
    const after = clause.masked.slice(number.end);
    const signMark = SIGN_MARK.exec(clause.masked.slice(0, number.index));
    const before = clause.masked.slice(0, signMark?.index ?? number.index);
    let sign: StatedFigure['sign'] = null;
    let raw = number.raw;
    if (/^[+-]/u.test(number.raw)) {
        sign = value < 0 ? -1 : 1;
    } else if (signMark !== null) {
        sign = signMark[1]?.toLowerCase() === 'plus' ? 1 : -1;
        raw = `${sign < 0 ? '-' : '+'}${number.raw}`;
    }
    const words = normalizePromptText(`${before} ${after}`);
    return {
        magnitude: Math.abs(value),
        sign,
        raw,
        unit: readUnit(number.raw, after),
        connector: readConnector(before),
        direction: readDirection(words),
        words,
    };
}

function getLevelArguments(actionType: string): { absolute: string | null; relative: string | null } {
    const rules = getExecutableAppActionGroundingRules(actionType)?.valueRules ?? [];
    const find = (form: 'absolute-decibel' | 'relative-decibel') =>
        rules.find((rule) => rule.kind === 'number-if-present' && rule.levelForm === form)?.argument ?? null;
    return { absolute: find('absolute-decibel'), relative: find('relative-decibel') };
}

function clarify(question: string): ValueResolution {
    return { status: 'clarify', question };
}

/**
 * Which way a move goes: the direction its words state, else its sign, else the pending change's.
 * The pending direction is kept only when every word beside the figure states none; a word this
 * reading cannot tell, or a stated direction its sign contradicts, is asked.
 */
function readMoveDirection(figure: StatedFigure, pendingSign: -1 | 1 | null): MoveDirection {
    const question = `Should the change of ${figure.raw} dB go up or down?`;
    const stated = figure.direction === null ? figure.sign : figure.direction;
    if (stated === 'conflicting' || (stated !== null && figure.sign !== null && figure.sign !== stated)) {
        return { status: 'clarify', question };
    }
    if (stated !== null) {
        return { status: 'direction', sign: stated, kept: false };
    }
    if (pendingSign === null) {
        return { status: 'clarify', question };
    }
    const unreadWord = findUnreadWord(figure.words);
    if (unreadWord !== null) {
        return { status: 'clarify', question: `${question} "${unreadWord}" does not say.` };
    }
    return { status: 'direction', sign: pendingSign, kept: true };
}

function resolveRelativeLevel(
    relative: string,
    value: NonNullable<ProposalGroundingCommand['value']>,
    figure: StatedFigure
): ValueResolution {
    let pendingSign: -1 | 1 | null = null;
    if (value.form === 'relative' && value.value !== 0) {
        pendingSign = value.value < 0 ? -1 : 1;
    }
    const statesMove = figure.connector === 'relative' || figure.direction !== null;
    if (!statesMove && figure.sign !== null) {
        return clarify(
            `Is ${figure.raw} dB where the level should land ("at ${figure.raw} dB") or how far it should move ("by ${figure.raw} dB")?`
        );
    }
    if (!statesMove && pendingSign === null) {
        return clarify(
            `Is ${figure.raw} dB where the level should land or how far it should move, and in which direction?`
        );
    }
    const move = readMoveDirection(figure, pendingSign);
    if (move.status === 'clarify') {
        return move;
    }
    return {
        status: 'bound',
        argument: relative,
        expected: move.sign * figure.magnitude,
        keptPendingDirection: move.kept,
    };
}

/**
 * A move stated against a pending absolute level moves that level: "3 dB quieter" than "at -6 dB" is
 * at -9 dB, never 3 dB below where the fader is now, which the card never proposed.
 */
function movePendingLevel(
    value: NonNullable<ProposalGroundingCommand['value']>,
    figure: StatedFigure
): ValueResolution {
    const move = readMoveDirection(figure, null);
    if (move.status === 'clarify') {
        return move;
    }
    return {
        status: 'bound',
        argument: value.argument,
        expected: value.value + move.sign * figure.magnitude,
        keptPendingDirection: false,
    };
}

/**
 * A decibel figure against a pending level: `at`/`to` lands it, `by`/`up`/`down` moves it — from the
 * pending level when that is absolute — and an unsigned figure with neither keeps the pending change's
 * form and sign. A signed figure with no connector, or an unsigned one against a pending absolute
 * level, could be either and is asked.
 */
function resolveLevelValue(
    command: ProposalGroundingCommand,
    value: NonNullable<ProposalGroundingCommand['value']>,
    figure: StatedFigure
): ValueResolution {
    if (figure.unit !== 'dB') {
        return clarify(`The pending change is stated in dB. Should ${figure.raw} be in dB?`);
    }
    if (figure.direction === 'conflicting') {
        return clarify(`Should ${figure.raw} dB go up or down?`);
    }
    const levels = getLevelArguments(command.type);
    if (figure.connector === 'absolute') {
        if (levels.absolute === null) {
            return { status: 'refused', reason: 'The pending change cannot be set to an absolute level.' };
        }
        const expected = (figure.sign ?? 1) * figure.magnitude;
        return { status: 'bound', argument: levels.absolute, expected, keptPendingDirection: false };
    }
    if (value.form === 'absolute' && (figure.connector === 'relative' || figure.direction !== null)) {
        return movePendingLevel(value, figure);
    }
    if (levels.relative === null) {
        return { status: 'refused', reason: 'The pending change cannot move by a relative amount.' };
    }
    return resolveRelativeLevel(levels.relative, value, figure);
}

function isSignedDomain(command: ProposalGroundingCommand, context: ProjectContext): boolean {
    if (command.type === 'setTrackPan') {
        return true;
    }
    const deviceId = command.targets.find((target) => target.argument === 'deviceId')?.id;
    const paramId = command.targets.find((target) => target.argument === 'paramId')?.id;
    const parameter = context.tracks
        .flatMap((track) => track.devices)
        .find((device) => device.id === deviceId)
        ?.parameters?.find((candidate) => candidate.id === paramId);
    return (parameter?.minValue ?? 0) < 0 || (command.value?.value ?? 0) < 0;
}

/**
 * Any other figure lands where it says, read by the clause's own wording; a relative change, a
 * signed figure with no connector, an unsigned one in a signed range, or a figure with no connector
 * beside a word this reading cannot tell is asked instead. Side and direction words are read only
 * outside object names, so a track named "Left Guitar" states no side.
 */
function resolvePlainValue(
    command: ProposalGroundingCommand,
    value: NonNullable<ProposalGroundingCommand['value']>,
    figure: StatedFigure,
    context: ProjectContext
): ValueResolution {
    if (figure.sign !== null && figure.connector === null) {
        return clarify(`Is ${figure.raw} where the value should land? Say "to ${figure.raw}".`);
    }
    const moveQuestion = `Say where the value should land instead of how far it should move from ${figure.raw}.`;
    if (figure.connector === 'relative' || figure.direction !== null || statesWord(figure.words, RELATIVE_WORDS)) {
        return clarify(moveQuestion);
    }
    const isPan = command.type === 'setTrackPan';
    const unreadWord = findUnreadWord(figure.words, isPan ? PAN_WORDS : new Set());
    if (figure.connector === null && unreadWord !== null) {
        return clarify(`Where should the value land? "${unreadWord}" beside ${figure.raw} does not say.`);
    }
    const statesSide = isPan && statesWord(figure.words, PAN_SIDE_WORDS);
    if (figure.connector === null && figure.sign === null && isSignedDomain(command, context) && !statesSide) {
        return clarify(`Should ${figure.raw} be positive or negative?`);
    }
    return { status: 'bound', argument: value.argument, expected: null, keptPendingDirection: false };
}

function isUnitCompatible(command: ProposalGroundingCommand, figure: StatedFigure): boolean {
    if (command.value === null) {
        return false;
    }
    if (command.value.unit === 'dB') {
        return figure.unit === 'dB' || figure.unit === null;
    }
    return figure.unit !== 'dB' || command.type === 'setDeviceParameter';
}

function resolveFigure(
    view: PendingCommandView,
    figure: StatedFigure,
    clause: RefinementClause,
    context: ProjectContext
): FigureRead {
    const value = view.command.value;
    if (value === null) {
        return { kind: 'refused', reason: `The pending change "${clause.text.trim()}" means has no value to change.` };
    }
    let resolution: ValueResolution;
    if (value.unit === 'dB') {
        resolution = resolveLevelValue(view.command, value, figure);
    } else {
        resolution = resolvePlainValue(view.command, value, figure, context);
    }
    if (resolution.status === 'clarify') {
        return { kind: 'clarify', question: resolution.question };
    }
    if (resolution.status === 'refused') {
        return { kind: 'refused', reason: resolution.reason };
    }
    const { argument, expected, keptPendingDirection } = resolution;
    return { kind: 'value', index: view.index, value: { clause, argument, expected, keptPendingDirection } };
}

/**
 * What the figure one refinement clause states binds to among the pending commands the clause can
 * mean: exactly one of them of the stated unit, or nothing guessed. A clause with no figure restates
 * the commands it names by their own action, or asks for something the card does not carry.
 */
export function bindRefinementFigure(input: {
    clause: RefinementClause;
    /** The pending commands the clause can mean: the ones it names, else all it keeps, narrowed to its action. */
    scoped: readonly PendingCommandView[];
    /** The pending commands the clause would mean the same way but the refinement removes. */
    removed: readonly PendingCommandView[];
    namesObjects: boolean;
    statesAction: boolean;
    context: ProjectContext;
}): FigureRead {
    const { clause, scoped } = input;
    const figure = readFigure(clause);
    if (figure === 'none') {
        if (input.namesObjects && input.statesAction && scoped.length > 0) {
            return { kind: 'restated' };
        }
        return { kind: 'addition' };
    }
    if (figure === 'several' || figure === 'unreadable') {
        return { kind: 'refused', reason: `The refinement clause "${clause.text.trim()}" states more than one value.` };
    }
    const unit = figure.unit === 'dB' ? ' dB' : '';
    const compatible = scoped.filter((view) => isUnitCompatible(view.command, figure));
    if (compatible.length === 0 && input.removed.some((view) => isUnitCompatible(view.command, figure))) {
        return {
            kind: 'refused',
            reason: `${figure.raw}${unit} in "${clause.text.trim()}" can only mean a pending change the refinement removes.`,
        };
    }
    if (scoped.length === 0) {
        if (input.statesAction || input.namesObjects) {
            return { kind: 'addition' };
        }
        return { kind: 'refused', reason: `The pending proposal has no value "${clause.text.trim()}" could change.` };
    }
    const [only] = compatible;
    if (only === undefined) {
        return { kind: 'refused', reason: `The pending proposal has no value stated in the unit of ${figure.raw}.` };
    }
    if (compatible.length > 1) {
        return { kind: 'clarify', question: `Which pending change should ${figure.raw}${unit} apply to?` };
    }
    return resolveFigure(only, figure, clause, input.context);
}
