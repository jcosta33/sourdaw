import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalGroundingCommand } from '../../models/ProposalGroundingBasis';

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
};

type ValueResolution =
    | { status: 'bound'; argument: string; expected: number | null; keptPendingDirection: boolean }
    | { status: 'clarify'; question: string }
    | { status: 'refused'; reason: string };

const UP_WORDS = /\b(?:up|louder|raise|higher|increase|boost)\b/u;
const DOWN_WORDS = /\b(?:down|quieter|lower|decrease|reduce|cut|softer)\b/u;
const PAN_SIDE_WORDS = /\b(?:left|right)\b/u;

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

function readDirection(words: string): StatedFigure['direction'] {
    const up = UP_WORDS.test(words);
    const down = DOWN_WORDS.test(words);
    if (up && down) {
        return 'conflicting';
    }
    if (up) {
        return 1;
    }
    return down ? -1 : null;
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
    const before = clause.masked.slice(0, number.index);
    let sign: StatedFigure['sign'] = null;
    if (/^[+-]/u.test(number.raw)) {
        sign = value < 0 ? -1 : 1;
    }
    return {
        magnitude: Math.abs(value),
        sign,
        raw: number.raw,
        unit: readUnit(number.raw, after),
        connector: readConnector(before),
        direction: readDirection(normalizePromptText(`${before} ${after}`)),
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

function resolveRelativeLevel(
    relative: string,
    value: NonNullable<ProposalGroundingCommand['value']>,
    figure: StatedFigure
): ValueResolution {
    let pendingSign: -1 | 1 | null = null;
    if (value.form === 'relative' && value.value !== 0) {
        pendingSign = value.value < 0 ? -1 : 1;
    }
    if (figure.connector === 'relative' || figure.direction !== null) {
        const direction = figure.direction === null ? (figure.sign ?? pendingSign) : figure.direction;
        if (direction === null || direction === 'conflicting' || (figure.sign !== null && figure.sign !== direction)) {
            return clarify(`Should the change of ${figure.raw} dB go up or down?`);
        }
        return {
            status: 'bound',
            argument: relative,
            expected: direction * figure.magnitude,
            keptPendingDirection: figure.direction === null && figure.sign === null,
        };
    }
    if (figure.sign !== null) {
        return clarify(
            `Is ${figure.raw} dB where the level should land ("at ${figure.raw} dB") or how far it should move ("by ${figure.raw} dB")?`
        );
    }
    if (pendingSign === null) {
        return clarify(
            `Is ${figure.raw} dB where the level should land or how far it should move, and in which direction?`
        );
    }
    return {
        status: 'bound',
        argument: relative,
        expected: pendingSign * figure.magnitude,
        keptPendingDirection: true,
    };
}

/**
 * A decibel figure against a pending level: `at`/`to` lands it, `by`/`up`/`down` moves it, and an
 * unsigned figure with neither keeps the pending change's form and sign. A signed figure with no
 * connector, or an unsigned one against a pending absolute level, could be either and is asked.
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
 * signed figure with no connector, or an unsigned one in a signed range is asked instead.
 */
function resolvePlainValue(
    command: ProposalGroundingCommand,
    value: NonNullable<ProposalGroundingCommand['value']>,
    figure: StatedFigure,
    clause: RefinementClause,
    context: ProjectContext
): ValueResolution {
    if (figure.sign !== null && figure.connector === null) {
        return clarify(`Is ${figure.raw} where the value should land? Say "to ${figure.raw}".`);
    }
    if (figure.connector === 'relative' || figure.direction !== null) {
        return clarify(`Say where the value should land instead of how far it should move from ${figure.raw}.`);
    }
    const statesSide = command.type === 'setTrackPan' && PAN_SIDE_WORDS.test(normalizePromptText(clause.text));
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
        resolution = resolvePlainValue(view.command, value, figure, clause, context);
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
    /** The pending commands the clause can mean: the ones it names, else all, narrowed to its action. */
    scoped: readonly PendingCommandView[];
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
    if (scoped.length === 0) {
        if (input.statesAction || input.namesObjects) {
            return { kind: 'addition' };
        }
        return { kind: 'refused', reason: `The pending proposal has no value "${clause.text.trim()}" could change.` };
    }
    const compatible = scoped.filter((view) => isUnitCompatible(view.command, figure));
    const [only] = compatible;
    if (only === undefined) {
        return { kind: 'refused', reason: `The pending proposal has no value stated in the unit of ${figure.raw}.` };
    }
    if (compatible.length > 1) {
        const unit = figure.unit === 'dB' ? ' dB' : '';
        return { kind: 'clarify', question: `Which pending change should ${figure.raw}${unit} apply to?` };
    }
    return resolveFigure(only, figure, clause, input.context);
}
