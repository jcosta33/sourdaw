import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalGroundingCommand } from '../../models/ProposalGroundingBasis';

import { LOUDER_SCOPE_PHRASES, QUIETER_SCOPE_PHRASES } from './groundingStrategies/classifyPromptDecibelFigures';
import { findPromptNumbers } from './groundingStrategies/findPromptNumbers';
import { normalizePromptText } from './groundingStrategies/normalizePromptText';
import { parsePromptNumberValue } from './groundingStrategies/parsePromptNumberValue';
import { type PromptClause } from './groundingStrategies/promptScope';
import { refinementActionWords } from './refinementActionWords';
import { refinementValueUnits } from './refinementValueUnits';

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
    /** The boolean a toggle word states for `argument` ("unmute" is `false`), or `null` for a figure. */
    toggled: boolean | null;
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
    /** The unit the figure is stated in, by its canonical spelling (`%`, `dB`, `Hz`, `bpm`, ...). */
    unit: string | null;
    connector: 'absolute' | 'relative' | null;
    /** The connector word stated before the figure with other words between them ("at the 6 dB"), if any. */
    separatedConnector: string | null;
    direction: -1 | 1 | null | 'conflicting';
    /** The words beside the figure, read from the clause with every object name masked. */
    words: string;
    /** A symbol touching the figure that this reading does not read as its sign, decimal mark or percent. */
    symbol: string | null;
};

type ValueResolution =
    | { status: 'bound'; argument: string; expected: number | null; keptPendingDirection: boolean }
    | { status: 'clarify'; question: string }
    | { status: 'refused'; reason: string };

type MoveDirection = { status: 'direction'; sign: -1 | 1; kept: boolean } | { status: 'clarify'; question: string };

/** The words that move a level down or up: the scope phrases any level request is read by, plus `down` and `up`. */
const LOWERING_PHRASES: readonly string[] = [...QUIETER_SCOPE_PHRASES, 'down'];
const RAISING_PHRASES: readonly string[] = [...LOUDER_SCOPE_PHRASES, 'up'];
const LEVEL_DIRECTION_PHRASES: readonly string[] = [...LOWERING_PHRASES, ...RAISING_PHRASES];
/** The words the level phrases are spelled in, which a value clause reads as the direction they state. */
const LEVEL_DIRECTION_WORDS: ReadonlySet<string> = new Set(
    LEVEL_DIRECTION_PHRASES.flatMap((phrase) => phrase.split(' '))
);

const PAN_SIDE_WORDS: ReadonlySet<string> = new Set(['left', 'right']);
const MOVING_VERBS: ReadonlySet<string> = new Set(refinementActionWords.movingVerbs);
/** Words a pan clause reads itself: the operation and the side it lands on. */
const PAN_WORDS: ReadonlySet<string> = new Set(['pan', 'panning', ...PAN_SIDE_WORDS]);
/**
 * A mix figure says how much of the signal is wet, so "wet" beside it states no direction. "Dry" is
 * not read: "60% dry" is 40% wet, which a plain value that lands where it says would invert.
 */
const MIX_WORDS: ReadonlySet<string> = new Set(['wet']);
/**
 * A sign spoken or typeset before the figure, touching it or a space away: "minus 1.5 dB", and any
 * dash or minus character — "-", "–" (U+2013), "‑" (U+2011), "−" (U+2212) — as in "by – 1.5 dB".
 */
const SIGN_MARK = /(?:\b(minus|plus)\s+|([\p{Pd}−])\s*)$/iu;
/**
 * A symbol or punctuation mark: beside a figure it may be a sign this reading does not read ("➖",
 * "⁻", "＋"). The glyph a masked object name is written in is no such mark.
 */
const UNREAD_MARK = /[\p{S}\p{P}]/u;
const PROJECT_REFERENCE_MASK_GLYPH = '□';
/**
 * Words that compare the figure with something: "2 dB more", "1 dB quieter". Against a pending move
 * they cannot say whether the figure replaces that move or adds to it, so such a clause is asked.
 */
const COMPARATIVE_WORDS: ReadonlySet<string> = new Set([
    'higher',
    'hotter',
    'less',
    'louder',
    'lower',
    'more',
    'quieter',
    'softer',
]);
/** The connectors a figure is read after, which belong to the figure rather than the action. */
const CONNECTOR_WORDS: ReadonlySet<string> = new Set(['to', 'at', 'by']);
/** A quotation mark: a value clause quoting anything states words this reading never reads. */
const QUOTE_MARK = /["'“”‘’«»`]/u;
/**
 * The closed vocabulary a value clause is read in. Beside its figure, the unit word that figure is read
 * in and the object names it states, a clause binds a value only when every other word is one of these:
 * a verb that sets a value, a pronoun or article, the connector that says whether the figure lands or
 * moves, "please", and a conjunction opening the clause. The level phrase words any request reads are
 * read as the direction they state, a pan's own words and sides only beside a pan, and "wet" only beside
 * a mix. Any other word ("negative", "below", "another", "again", "go") may say something about the
 * value this reading cannot tell, so the clause is asked rather than bound by the words it does know.
 */
const VALUE_CLAUSE_WORDS: ReadonlySet<string> = new Set([
    ...refinementActionWords.valueVerbs,
    'it',
    'its',
    'the',
    'a',
    'them',
    'to',
    'at',
    'by',
    'please',
]);

/** The unit a figure is stated in, and how much of the text after it the unit word takes. */
function readUnit(raw: string, after: string): { unit: StatedFigure['unit']; length: number } {
    if (raw.endsWith('%')) {
        return { unit: '%', length: 0 };
    }
    return refinementValueUnits.unitWord(after) ?? { unit: null, length: 0 };
}

/**
 * The connector the figure follows: `at`/`to` lands it, `by` moves it. A connector reads only when
 * nothing but whitespace stands between it and the figure (or the sign before it); the last connector
 * of the clause with words after it is returned as separated, since "at the 6 dB" or "to a 2 dB cut"
 * may say something about the figure this reading cannot tell.
 */
function readConnector(before: string): Pick<StatedFigure, 'connector' | 'separatedConnector'> {
    const last = Array.from(before.matchAll(/(?<![\p{L}\p{N}])(at|to|by)(?![\p{L}\p{N}])/giu)).at(-1);
    if (last === undefined) {
        return { connector: null, separatedConnector: null };
    }
    const word = last[1]!.toLowerCase();
    if (before.slice(last.index + last[0].length).trim().length > 0) {
        return { connector: null, separatedConnector: word };
    }
    return { connector: word === 'by' ? 'relative' : 'absolute', separatedConnector: null };
}

function namesPhrase(words: string, phrase: string): boolean {
    return ` ${words} `.includes(` ${phrase} `);
}

/**
 * Which way the words beside the figure move a level, read by the scope phrases any level request is
 * read by, plus the `up` and `down` a figure may follow.
 */
function readDirection(words: string): StatedFigure['direction'] {
    const lowers = LOWERING_PHRASES.some((phrase) => namesPhrase(words, phrase));
    const raises = RAISING_PHRASES.some((phrase) => namesPhrase(words, phrase));
    if (lowers && raises) {
        return 'conflicting';
    }
    if (lowers) {
        return -1;
    }
    return raises ? 1 : null;
}

/** The first word beside the figure outside the closed vocabulary a value clause is read in, if any. */
function findUnreadWord(words: string, alsoRead: ReadonlySet<string>): string | null {
    const tokens = words.split(' ').filter((word) => word.length > 0);
    const verbIndex = refinementActionWords.verbIndex(tokens);
    return (
        tokens.find(
            (word, index) =>
                index >= verbIndex &&
                !VALUE_CLAUSE_WORDS.has(word) &&
                !LEVEL_DIRECTION_WORDS.has(word) &&
                !alsoRead.has(word)
        ) ?? null
    );
}

/** The side a pan clause's words state: `left` is negative, `right` positive. */
function readSide(words: string): -1 | 1 | null | 'conflicting' {
    const tokens = new Set(words.split(' ').filter((word) => PAN_SIDE_WORDS.has(word)));
    const left = tokens.has('left');
    const right = tokens.has('right');
    if (left && right) {
        return 'conflicting';
    }
    if (left) {
        return -1;
    }
    return right ? 1 : null;
}

/**
 * The comparative the words beside a figure state, if any. "Lower" opening the clause is its verb
 * ("lower it 2 dB"), a move like "drop", not a comparison.
 */
function findComparativeWord(words: string): string | null {
    const tokens = words.split(' ').filter((word) => word.length > 0);
    const verbIndex = refinementActionWords.verbIndex(tokens);
    return (
        tokens.find((word, index) => COMPARATIVE_WORDS.has(word) && !(word === 'lower' && index === verbIndex)) ?? null
    );
}

/** The one figure a clause states, with its unit, connector and direction, read from the masked clause. */
function readFigure(clause: RefinementClause): StatedFigure | 'none' | 'several' | 'unreadable' | 'quoted' {
    const numbers = findPromptNumbers(clause.masked);
    const [number] = numbers;
    if (number === undefined) {
        return 'none';
    }
    if (numbers.length > 1) {
        return 'several';
    }
    if (QUOTE_MARK.test(clause.masked)) {
        return 'quoted';
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
    const unit = readUnit(number.raw, after);
    const words = normalizePromptText(`${before} ${after.slice(unit.length)}`);
    return {
        magnitude: Math.abs(value),
        sign,
        raw,
        unit: unit.unit,
        ...readConnector(before),
        direction: readDirection(words),
        words,
        symbol: findTouchingMark(before, after),
    };
}

/**
 * A mark touching the figure that is none of the ones it is read by: the decimal mark and percent sign
 * inside the figure, and the sign before it. The mark before may stand a space away, as a read sign
 * may; a mark after the figure touches it.
 */
function findTouchingMark(before: string, after: string): string | null {
    const touching = [/(\S)\s*$/u.exec(before)?.[1], after.at(0)];
    return (
        touching.find(
            (character): character is string =>
                character !== undefined && character !== PROJECT_REFERENCE_MASK_GLYPH && UNREAD_MARK.test(character)
        ) ?? null
    );
}

/** The comparative a clause states beside its one figure ("2 dB more", "1 dB quieter"), if it states both. */
function readFigureComparative(clause: RefinementClause): string | null {
    const figure = readFigure(clause);
    return typeof figure === 'string' ? null : findComparativeWord(figure.words);
}

/** Whether a clause states anything of a value: a figure, a level direction, a pan side or a unit. */
function statesValue(clause: RefinementClause): boolean {
    const words = normalizePromptText(clause.masked);
    return (
        findPromptNumbers(clause.masked).length > 0 ||
        readDirection(words) !== null ||
        readSide(words) !== null ||
        refinementValueUnits.statesUnitWord(words)
    );
}

/** Whether a clause's figure can mean this pending command: any clause without one figure can. */
function canMean(clause: RefinementClause, command: ProposalGroundingCommand, context: ProjectContext): boolean {
    const figure = readFigure(clause);
    return typeof figure === 'string' || isUnitCompatible(command, figure, context);
}

/** The way a pending change already moves: a level move's sign, or a pan's side. */
function readPendingDirection(command: ProposalGroundingCommand): -1 | 1 | null {
    const { value } = command;
    if (value === null || value.value === 0) {
        return null;
    }
    const signed = command.type === 'setTrackPan' || (value.unit === 'dB' && value.form === 'relative');
    if (!signed) {
        return null;
    }
    return value.value < 0 ? -1 : 1;
}

/**
 * The words a pending command's source clause states its action in: the clause's words beside its one
 * figure, without the unit and connector that figure is read in ("turn Vocals down 3 dB" is "turn
 * down", "mute Bass" is "mute"). `null` when the clause states its value in a shape no figure reads.
 */
function readOwnActionWords(sourceClause: RefinementClause): string[] | null {
    const figure = readFigure(sourceClause);
    if (figure === 'none') {
        return refinementActionWords.actionWords(sourceClause.masked);
    }
    if (typeof figure === 'string') {
        return null;
    }
    return refinementActionWords.actionWords(figure.words).filter((word) => !CONNECTOR_WORDS.has(word));
}

/**
 * What to ask of a clause that states no figure for a pending command it can mean. Naming a pending
 * object, it restates that command only in the pending command's own action words, as its source
 * clause stated them, plus articles, or states the toggle's own value in one of its type's toggle words
 * ("unmute Bass" against a pending mute), which binds that value: any other word ("off", "only",
 * "just", "instead of", "excluding", a direction against it, a unit) says something about the change
 * this reading cannot bind, so it is asked. Naming none, it restates the command only in the direction
 * the command already takes ("turn it down" against a pending cut); a direction against it, a direction
 * for a value that takes none, a level direction beside a pan, or a unit with no figure leaves the
 * value open.
 */
function findRestatementQuestion(input: {
    clause: RefinementClause;
    command: ProposalGroundingCommand;
    namesObjects: boolean;
    /** The pending command's own action words, or `null` when its source clause states none this reading reads. */
    ownActionWords: readonly string[] | null;
    context: ProjectContext;
}): string | null {
    const { clause, command } = input;
    if (findPromptNumbers(clause.masked).length > 0) {
        return null;
    }
    if (input.namesObjects) {
        const own = input.ownActionWords;
        const words = refinementActionWords.actionWords(clause.masked);
        if (
            (own !== null && refinementActionWords.isSame(words, own)) ||
            refinementActionWords.toggle(clause, command) !== null
        ) {
            return null;
        }
        return refinementActionWords.askRestatement(clause.text.trim(), own, command, input.context);
    }
    const words = normalizePromptText(clause.masked);
    const level = readDirection(words);
    const side = readSide(words);
    let stated: ReturnType<typeof readSide> = side === null ? level : 'conflicting';
    if (command.type === 'setTrackPan') {
        stated = level === null ? side : 'conflicting';
    }
    if (!refinementValueUnits.statesUnitWord(words) && (stated === null || stated === readPendingDirection(command))) {
        return null;
    }
    return `"${clause.text.trim()}" does not say what the value should be. State the new value, for example "make it 2 dB".`;
}

/** How the one figure a refinement clause states reads, beside the value it binds. */
export const refinementFigure = {
    comparative: readFigureComparative,
    statesValue,
    canMean,
    restatementQuestion: findRestatementQuestion,
    ownActionWords: readOwnActionWords,
} as const;

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
 * Which way a move goes: the direction its words state, else its sign, else the pending change's,
 * which the closed vocabulary its clause is read in leaves as the only reading. A stated direction its
 * sign contradicts is asked.
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
 * A comparative beside a decibel figure compares it with something the clause does not name. Against a
 * pending move, "2 dB more" or "1 dB quieter" could replace that move or add to it; beside a landing
 * ("at -9 dB more") it contradicts the landing. Only a pending absolute level gives a moving comparative
 * ("3 dB quieter") its anchor, which the move from the pending level reads.
 */
function findComparativeQuestion(
    value: NonNullable<ProposalGroundingCommand['value']>,
    figure: StatedFigure
): string | null {
    const comparative = findComparativeWord(figure.words);
    if (comparative === null || (value.form === 'absolute' && figure.connector !== 'absolute')) {
        return null;
    }
    const example = value.form === 'relative' ? `make it ${figure.raw} dB` : `put it at ${figure.raw} dB`;
    return `"${comparative}" beside ${figure.raw} dB does not say whether it replaces the pending change or adds to it. State the new value, for example "${example}".`;
}

/**
 * A decibel figure against a pending level: `at`/`to` lands it, `by`/`up`/`down` moves it — from the
 * pending level when that is absolute — and an unsigned figure with neither keeps the pending change's
 * form and sign. A signed figure with no connector, an unsigned one against a pending absolute level,
 * or a comparative beside the figure against a pending move could be either and is asked.
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
    const comparativeQuestion = findComparativeQuestion(value, figure);
    if (comparativeQuestion !== null) {
        return clarify(comparativeQuestion);
    }
    const levels = getLevelArguments(command.type);
    if (figure.connector === 'absolute') {
        if (figure.direction !== null) {
            // "Bring it down to 2 dB" states a move and a landing at once, and could mean either.
            return clarify(
                `Should the level land at ${figure.raw} dB, or move ${figure.raw} dB? Say "at ${figure.raw} dB" or "by ${figure.raw} dB".`
            );
        }
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
    return (
        (refinementValueUnits.pendingParameter(command, context)?.minValue ?? 0) < 0 || (command.value?.value ?? 0) < 0
    );
}

/** A wet/dry mix parameter, by its name or id: "Mix", "Reverb Mix", "Wet", `delayMix`. */
function isMixParameter(command: ProposalGroundingCommand, context: ProjectContext): boolean {
    const parameter = refinementValueUnits.pendingParameter(command, context);
    if (parameter === undefined) {
        return false;
    }
    const named = normalizePromptText(parameter.name ?? '').split(' ');
    return named.includes('mix') || named.includes('wet') || /(?:mix|^wet)$/iu.test(parameter.id);
}

/** The words a plain value's clause reads itself beside its figure: a pan's side, a mix's "wet". */
function getReadWords(command: ProposalGroundingCommand, context: ProjectContext): ReadonlySet<string> {
    if (command.type === 'setTrackPan') {
        return PAN_WORDS;
    }
    return isMixParameter(command, context) ? MIX_WORDS : new Set();
}

/**
 * Any other figure lands only where it says: unsigned, after `to`/`at` or standing bare, read by the
 * clause's own wording. A signed figure, a relative change, a bare figure in a signed range, and a pan
 * with neither a side nor `to`/`at` are asked instead. Side and direction words are read only outside
 * object names, so a track named "Left Guitar" states no side.
 */
function resolvePlainValue(
    command: ProposalGroundingCommand,
    value: NonNullable<ProposalGroundingCommand['value']>,
    figure: StatedFigure,
    context: ProjectContext
): ValueResolution {
    const isPan = command.type === 'setTrackPan';
    if (isPan && readSide(figure.words) === 'conflicting') {
        return clarify(`Which side should it pan to? Say "${figure.magnitude} left" or "${figure.magnitude} right".`);
    }
    if (figure.sign !== null) {
        const unsigned = String(figure.magnitude);
        return clarify(
            isPan
                ? `Which side should it pan to? Say "${unsigned} left" or "${unsigned} right".`
                : `Is ${figure.raw} where the value should land? A refinement reads no signed value; restate the change with its target, as in "set ... to ${figure.raw}".`
        );
    }
    if (figure.connector === 'relative' || figure.direction !== null) {
        return clarify(`Say where the value should land instead of how far it should move from ${figure.raw}.`);
    }
    if (figure.connector === 'absolute') {
        return { status: 'bound', argument: value.argument, expected: null, keptPendingDirection: false };
    }
    const statesSide = isPan && readSide(figure.words) !== null;
    if (isSignedDomain(command, context) && !statesSide) {
        return clarify(`Should ${figure.raw} be positive or negative?`);
    }
    return { status: 'bound', argument: value.argument, expected: null, keptPendingDirection: false };
}

/** A figure can mean a pending value it states no unit for, or one stated in the value's own unit. */
function isUnitCompatible(command: ProposalGroundingCommand, figure: StatedFigure, context: ProjectContext): boolean {
    if (command.value === null) {
        return false;
    }
    return figure.unit === null || figure.unit === refinementValueUnits.ownUnit(command, context);
}

/**
 * A figure in another unit than the one pending value the clause can mean: asked for a plain value,
 * whose figure may only be in its own unit, and refused for a level, as any figure in a unit no pending
 * value takes is.
 */
function readUnitMismatch(
    scoped: readonly PendingCommandView[],
    figure: StatedFigure,
    context: ProjectContext
): FigureRead {
    const valued = scoped.filter((view) => view.command.value !== null);
    const [only] = valued;
    if (valued.length === 1 && only !== undefined && only.command.value?.unit !== 'dB') {
        const own = refinementValueUnits.ownUnit(only.command, context);
        const stated = `${figure.raw} ${figure.unit ?? ''}`.trim();
        return {
            kind: 'clarify',
            question:
                own === null
                    ? `The pending value takes no unit. What should it be instead of ${stated}?`
                    : `The pending value is in ${own}. What should it be in ${own} instead of ${stated}?`,
        };
    }
    return { kind: 'refused', reason: `The pending proposal has no value stated in the unit of ${figure.raw}.` };
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
    const unreadWord = findUnreadWord(figure.words, getReadWords(view.command, context));
    if (unreadWord !== null) {
        const stated = figure.unit === null || figure.raw.endsWith('%') ? figure.raw : `${figure.raw} ${figure.unit}`;
        return {
            kind: 'clarify',
            question: `What should the value be? "${unreadWord}" beside ${stated} does not say; state the new value alone, as in "make it ${stated}".`,
        };
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
    return {
        kind: 'value',
        index: view.index,
        value: { clause, argument, expected, keptPendingDirection, toggled: null },
    };
}

type FigureClauseInput = {
    clause: RefinementClause;
    /** The pending commands the clause can mean: the ones it names, else all it keeps, narrowed to its action. */
    scoped: readonly PendingCommandView[];
    /** The pending commands the clause would mean the same way but the refinement removes. */
    removed: readonly PendingCommandView[];
    namesObjects: boolean;
    statesAction: boolean;
    /** Each pending command's own action words, by its index, or `null` when its source states none. */
    ownActionWords: (index: number) => readonly string[] | null;
    context: ProjectContext;
};

/**
 * A clause with no figure restates the pending commands it names by their own action, binds the value
 * a toggle word states, or asks for something the card does not carry.
 */
function readFigurelessClause(input: FigureClauseInput): FigureRead {
    const { clause, scoped } = input;
    if (!input.namesObjects || scoped.length === 0) {
        return { kind: 'addition' };
    }
    const toggled = refinementActionWords.toggledChange(clause, scoped);
    if (toggled.status === 'several') {
        return { kind: 'clarify', question: `Which pending change should "${clause.text.trim()}" apply to?` };
    }
    if (toggled.status === 'one') {
        const value = { clause, ...toggled.value, expected: null, keptPendingDirection: false };
        return { kind: 'value', index: toggled.index, value };
    }
    const question = scoped
        .map((view) =>
            findRestatementQuestion({
                clause,
                command: view.command,
                namesObjects: true,
                ownActionWords: input.ownActionWords(view.index),
                context: input.context,
            })
        )
        .find((candidate) => candidate !== null);
    return question === undefined ? { kind: 'restated' } : { kind: 'clarify', question };
}

/**
 * What the figure one refinement clause states binds to among the pending commands the clause can
 * mean: exactly one of them of the stated unit, or nothing guessed.
 */
export function bindRefinementFigure(input: FigureClauseInput): FigureRead {
    const { clause, scoped } = input;
    const figure = readFigure(clause);
    if (figure === 'none') {
        return readFigurelessClause(input);
    }
    if (figure === 'several') {
        return {
            kind: 'clarify',
            question: `"${clause.text.trim()}" states more than one figure. State the one new value, as in "make it 2 dB".`,
        };
    }
    if (figure === 'unreadable') {
        return { kind: 'refused', reason: `The refinement clause "${clause.text.trim()}" states more than one value.` };
    }
    if (figure === 'quoted') {
        return {
            kind: 'clarify',
            question: `What should the value be? "${clause.text.trim()}" quotes words beside its figure; state the new value without them, as in "make it 2 dB".`,
        };
    }
    if (figure.symbol !== null) {
        return {
            kind: 'clarify',
            question: `What does "${figure.symbol}" beside ${figure.raw} mean? Restate the value without it, writing a sign as "-", "+", "minus" or "plus".`,
        };
    }
    if (figure.separatedConnector !== null) {
        return {
            kind: 'clarify',
            question: `What should the value be? Words stand between "${figure.separatedConnector}" and ${figure.raw}; state it as "${figure.separatedConnector} ${figure.raw}".`,
        };
    }
    if (readSide(figure.words) !== null && figure.words.split(' ').some((word) => MOVING_VERBS.has(word))) {
        return {
            kind: 'clarify',
            question: `Should the pan land at ${figure.magnitude} or move ${figure.magnitude} toward that side? Say where it should land, as in "pan it ${figure.magnitude} right".`,
        };
    }
    const unit = figure.unit === 'dB' ? ' dB' : '';
    const compatible = scoped.filter((view) => isUnitCompatible(view.command, figure, input.context));
    if (
        compatible.length === 0 &&
        input.removed.some((view) => isUnitCompatible(view.command, figure, input.context))
    ) {
        return {
            kind: 'refused',
            reason: `${figure.raw}${unit} in "${clause.text.trim()}" can only mean a pending change the refinement removes.`,
        };
    }
    if (scoped.length === 0) {
        if (input.statesAction) {
            return { kind: 'addition' };
        }
        return { kind: 'refused', reason: `The pending proposal has no value "${clause.text.trim()}" could change.` };
    }
    const [only] = compatible;
    if (only === undefined) {
        return readUnitMismatch(scoped, figure, input.context);
    }
    if (compatible.length > 1) {
        return { kind: 'clarify', question: `Which pending change should ${figure.raw}${unit} apply to?` };
    }
    return resolveFigure(only, figure, clause, input.context);
}
