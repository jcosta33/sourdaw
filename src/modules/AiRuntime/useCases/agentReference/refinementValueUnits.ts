import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalGroundingCommand } from '../../models/ProposalGroundingBasis';

/** Each unit a figure may be stated in, by its canonical spelling, and the words that spell it. */
const UNIT_WORDS: ReadonlyArray<{ unit: string; pattern: RegExp }> = [
    { unit: '%', pattern: /^\s*(?:%|percent|per\s+cent)(?![\p{L}\p{N}])/iu },
    { unit: 'dB', pattern: /^\s*(?:d\s?b|decibels?)(?![\p{L}\p{N}])/iu },
    { unit: 'kHz', pattern: /^\s*(?:khz|kilohertz)(?![\p{L}\p{N}])/iu },
    { unit: 'Hz', pattern: /^\s*(?:hz|hertz)(?![\p{L}\p{N}])/iu },
    { unit: 'bpm', pattern: /^\s*bpm(?![\p{L}\p{N}])/iu },
    { unit: 'ms', pattern: /^\s*(?:ms|milliseconds?)(?![\p{L}\p{N}])/iu },
    { unit: 'beats', pattern: /^\s*beats?(?![\p{L}\p{N}])/iu },
    { unit: 'bars', pattern: /^\s*bars?(?![\p{L}\p{N}])/iu },
    { unit: 'semitones', pattern: /^\s*semitones?(?![\p{L}\p{N}])/iu },
    { unit: 'cents', pattern: /^\s*cents?(?![\p{L}\p{N}])/iu },
    { unit: 's', pattern: /^\s*(?:s|secs?|seconds?)(?![\p{L}\p{N}])/iu },
];

/** The unit word a text opens with, by its canonical spelling, and how much of the text it takes. */
function readUnitWord(text: string): { unit: string; length: number } | null {
    for (const { unit, pattern } of UNIT_WORDS) {
        const match = pattern.exec(text);
        if (match !== null) {
            return { unit, length: match[0].length };
        }
    }
    return null;
}

/** Whether the words name a unit a figure is read in. */
function statesUnitWord(words: string): boolean {
    return words.split(' ').some((word) => readUnitWord(word)?.length === word.length);
}

/** The device parameter a pending command sets, when it sets one. */
function findPendingParameter(command: ProposalGroundingCommand, context: ProjectContext) {
    const deviceId = command.targets.find((target) => target.argument === 'deviceId')?.id;
    const paramId = command.targets.find((target) => target.argument === 'paramId')?.id;
    return context.tracks
        .flatMap((track) => track.devices)
        .find((device) => device.id === deviceId)
        ?.parameters?.find((candidate) => candidate.id === paramId);
}

/**
 * The unit a pending value is stated in: dB for a level, a device parameter's own declared unit, a
 * percentage for a pan or a linear level the registry scales, and otherwise the unit a value argument
 * is named for (`bpm`, `semitones`, `beats`); `null` when it takes none.
 */
function getOwnUnit(command: ProposalGroundingCommand, context: ProjectContext): string | null {
    const { value } = command;
    if (value === null) {
        return null;
    }
    if (value.unit === 'dB') {
        return 'dB';
    }
    const parameter = findPendingParameter(command, context);
    if (parameter !== undefined) {
        return parameter.unit.trim().length === 0 ? null : (readUnitWord(parameter.unit)?.unit ?? parameter.unit);
    }
    const rule = getExecutableAppActionGroundingRules(command.type)?.valueRules.find(
        (candidate) => candidate.argument === value.argument
    );
    if (
        rule?.kind === 'number-if-present' &&
        (rule.direction === 'pan' || rule.scale === 'unit-interval' || rule.scale === 'percentage-only')
    ) {
        return '%';
    }
    return readUnitWord(value.argument)?.unit ?? null;
}

/** How a refinement figure's unit reads, and the unit a pending value is stated in. */
export const refinementValueUnits = {
    unitWord: readUnitWord,
    statesUnitWord,
    pendingParameter: findPendingParameter,
    ownUnit: getOwnUnit,
} as const;
