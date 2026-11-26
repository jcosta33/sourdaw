import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ProposalGroundingCommand } from '../../models/ProposalGroundingBasis';

import { FIGURE_WORD } from './positionWords';
import { readUnitWord } from './unitWords';

/**
 * Whether the words name a unit a figure is read in. A unit word reads apart from a figure too ("two
 * dB", "a few dB"), except the bare `s`, which a contraction leaves ("that's" reads "that s") and which
 * reads as seconds only directly after a figure.
 */
function statesUnitWord(words: string): boolean {
    const split = words.split(' ');
    return split.some(
        (word, index) =>
            readUnitWord(word)?.length === word.length && (word !== 's' || FIGURE_WORD.test(split[index - 1] ?? ''))
    );
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
