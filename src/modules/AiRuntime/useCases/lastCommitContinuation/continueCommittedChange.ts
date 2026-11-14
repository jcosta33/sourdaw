import { quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';
import { roundToThousandths } from '#/utils/Math/roundToThousandths';

import { clarify, denied } from '../../models/LastCommitRefusal';
import { type ProjectContext, type ProjectContextDeviceParameter } from '../../models/ProjectContext';
import { type ProposalGroundingValue } from '../../models/ProposalGroundingBasis';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { isAgentReferenceCapabilityCandidate } from '../agentReference/isAgentReferenceCapabilityCandidate';
import { proposalCommandShape } from '../agentReference/proposalCommandShape';

import { createsObjects } from './createsObjects';
import { groundContinuedCalls } from './groundContinuedCalls';
import {
    type CommittedBatch,
    type CommittedCommand,
    type ContinuedFigure,
    type ContinueRequest,
    type LastCommitContinuation,
} from './lastCommitOutcome';
import { readStatedArguments } from './readStatedArguments';

/**
 * The pan field's full scale on either side, as `setTrackPan` declares it ("-50 to 50") and the
 * action bridge holds it. The mixer strip shows that field as it stands (`L20` for -20), and a request
 * reads a pan percentage as that same figure ("pan Vocals 20% left" grounds to -20), so a continuation
 * figure in percent moves the field by exactly that figure.
 */
const PAN_LIMIT = 50;

/** A committed value outside decibels a continuation can move: a track's pan or a device parameter. */
type CommittedValue =
    | { kind: 'pan'; command: CommittedCommand; value: number; unit: '%' }
    | {
          kind: 'parameter';
          command: CommittedCommand;
          value: number;
          unit: string;
          deviceType: string;
          parameter: ProjectContextDeviceParameter;
      };

type CommittedValues = { status: 'read'; values: CommittedValue[] } | { status: 'gone'; command: CommittedCommand };

type FiguredRequest = ContinueRequest & { figure: number };

type ContinuedValue = { status: 'value'; value: number } | { status: 'refused'; outcome: LastCommitContinuation };

/** Whether every object the committed command acted on is still in the project, as its target rule reads it. */
function targetsStand(command: CommittedCommand, context: ProjectContext): boolean {
    return proposalCommandShape
        .targetObjects(command.type, command.payload)
        .every((target) =>
            isAgentReferenceCapabilityCandidate({ capability: target.capability, context, id: target.id })
        );
}

/** The committed levels in decibels of commands that create nothing, each with its committed value. */
function readCommittedLevels(committed: CommittedBatch) {
    return committed.commands.flatMap((command) => {
        const value = proposalCommandShape.value(command.type, command.payload);
        return value?.unit === 'dB' && !createsObjects(command.type) ? [{ command, value }] : [];
    });
}

function findDevice(deviceId: unknown, context: ProjectContext) {
    return context.tracks.flatMap((track) => track.devices).find((device) => device.id === deviceId);
}

/**
 * The committed pans and device parameters, each with the value the commit set and the unit its
 * control shows. A device parameter's unit is the one its descriptor declares, read from the device
 * as it stands, so a committed device removed since leaves nothing to read and is reported `gone`.
 */
function readCommittedValues(committed: CommittedBatch, context: ProjectContext): CommittedValues {
    const values: CommittedValue[] = [];
    for (const command of committed.commands) {
        const { payload } = command;
        if (command.type === 'setTrackPan' && typeof payload.pan === 'number') {
            values.push({ kind: 'pan', command, value: payload.pan, unit: '%' });
            continue;
        }
        if (command.type !== 'setDeviceParameter' || typeof payload.value !== 'number') {
            continue;
        }
        if (!targetsStand(command, context)) {
            return { status: 'gone', command };
        }
        const device = findDevice(payload.deviceId, context);
        const parameter = device?.parameters?.find((candidate) => candidate.id === payload.paramId);
        if (device === undefined || parameter === undefined) {
            return { status: 'gone', command };
        }
        values.push({
            kind: 'parameter',
            command,
            value: payload.value,
            unit: parameter.unit,
            deviceType: device.type,
            parameter,
        });
    }
    return { status: 'read', values };
}

function formatInUnit(value: number, unit: string): string {
    const figure = String(roundToThousandths(value));
    if (unit === '%') {
        return `${figure}%`;
    }
    return unit.trim().length === 0 ? figure : `${figure} ${unit}`;
}

function formatPan(value: number): string {
    if (value === 0) {
        return 'centre';
    }
    return `${formatInUnit(Math.abs(value), '%')} ${value < 0 ? 'left' : 'right'}`;
}

function sameUnit(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase();
}

/** A left pan moved back to the centre computes as -0, which the centre is never stored as. */
function centredAtPositiveZero(pan: number): number {
    return pan === 0 ? 0 : pan;
}

/**
 * The pan a continuation lands on, from the committed pan, never where the knob is now: "another" and
 * "more" move further toward the committed side, "less" back toward the centre. A centred pan has no
 * side to move toward, and a pan that would pass the limit or cross the centre is refused, never
 * clamped.
 */
function continuedPan(request: FiguredRequest, committed: number): ContinuedValue {
    const stated = formatInUnit(request.figure, '%');
    const phrase = request.phrasing === 'another' ? `Another ${stated}` : `"${stated} ${request.comparative}"`;
    if (committed === 0) {
        return {
            status: 'refused',
            outcome: clarify(
                `${phrase} does not say which side the centred committed pan should move to.`,
                `Which side should it move to? Say "pan it ${stated} left" or "pan it ${stated} right".`
            ),
        };
    }
    const side = Math.sign(committed);
    const size = Math.abs(committed);
    if (request.comparative === 'less') {
        if (request.figure > size) {
            return {
                status: 'refused',
                outcome: denied(
                    `"${stated} less" is more than the committed pan of ${formatPan(committed)}, so it would cross the centre rather than move toward it.`
                ),
            };
        }
        return { status: 'value', value: centredAtPositiveZero(roundToThousandths(side * (size - request.figure))) };
    }
    const limit = formatInUnit(PAN_LIMIT, '%');
    if (size >= PAN_LIMIT) {
        return {
            status: 'refused',
            outcome: denied(
                `The committed pan of ${formatPan(committed)} is already at the pan limit of ${limit}, so it has no room to move further.`
            ),
        };
    }
    if (size + request.figure > PAN_LIMIT) {
        return {
            status: 'refused',
            outcome: denied(
                `${phrase} would take the committed pan of ${formatPan(committed)} past the pan limit of ${limit}; it has ${formatInUnit(PAN_LIMIT - size, '%')} of room left to that side.`
            ),
        };
    }
    return { status: 'value', value: roundToThousandths(side * (size + request.figure)) };
}

/**
 * The value a continuation sets a committed device parameter to, from the committed value, never the
 * live one: "more" higher, "less" lower, and "another" asked, having no way to go. The figure is in
 * the parameter's own unit, and a parameter stores the figure its control shows (the panel and the
 * approval card print the stored value beside the declared unit), so the stored value is the committed
 * value moved by the figure, held to the parameter's declared range and to the settings its own law
 * represents, and refused outside either, never clamped or snapped.
 */
function continuedParameter(
    request: FiguredRequest,
    committed: Extract<CommittedValue, { kind: 'parameter' }>
): ContinuedValue {
    const { parameter } = committed;
    const stated = formatInUnit(request.figure, committed.unit);
    const committedText = formatInUnit(committed.value, committed.unit);
    if (request.phrasing === 'another') {
        return {
            status: 'refused',
            outcome: clarify(
                `"Another ${stated}" does not say which way the committed ${parameter.name} of ${committedText} should move.`,
                `Should it go up or down? Say "${stated} more" or "${stated} less".`
            ),
        };
    }
    const value = roundToThousandths(
        request.comparative === 'more' ? committed.value + request.figure : committed.value - request.figure
    );
    if (value < parameter.minValue || value > parameter.maxValue) {
        return {
            status: 'refused',
            outcome: denied(
                `"${stated} ${request.comparative}" would take ${parameter.name} from ${committedText} to ${formatInUnit(value, committed.unit)}, outside its range of ${formatInUnit(parameter.minValue, committed.unit)} to ${formatInUnit(parameter.maxValue, committed.unit)}.`
            ),
        };
    }
    if (quantiseDeviceParameterValue({ deviceType: committed.deviceType, paramId: parameter.id, value }) !== value) {
        return {
            status: 'refused',
            outcome: denied(
                `${parameter.name} has no setting at ${formatInUnit(value, committed.unit)}, so "${stated} ${request.comparative}" cannot be represented.`
            ),
        };
    }
    return { status: 'value', value };
}

function continuedCommittedValue(request: FiguredRequest, committed: CommittedValue): ContinuedValue {
    if (committed.kind === 'pan') {
        return continuedPan(request, committed.value);
    }
    return continuedParameter(request, committed);
}

/** The units the committed batch states values in, as a reason names them. */
function describeCommittedUnits(committed: CommittedBatch, values: readonly CommittedValue[]): string {
    const units: string[] = [];
    if (readCommittedLevels(committed).length > 0) {
        units.push('dB');
    }
    for (const value of values) {
        units.push(
            value.kind === 'pan'
                ? 'percent (pan)'
                : `${value.unit.trim().length === 0 ? 'no unit' : value.unit} (${value.parameter.name})`
        );
    }
    return [...new Set(units)].join(', ');
}

/** A further change of the committed pans and device parameters stated in the figure's unit. */
function continueCommittedValues(
    request: FiguredRequest & { unit: string },
    committed: CommittedBatch,
    context: ProjectContext
): LastCommitContinuation {
    const read = readCommittedValues(committed, context);
    if (read.status === 'gone') {
        return denied(
            `What the committed "${read.command.label}" acted on is no longer in the project, so it cannot be continued.`
        );
    }
    const stated = formatInUnit(request.figure, request.unit);
    if (request.figure === 0) {
        return denied(`A change of ${stated} leaves every committed value where it is.`);
    }
    const matching = read.values.filter((value) => sameUnit(value.unit, request.unit));
    if (matching.length === 0) {
        const held = describeCommittedUnits(committed, read.values);
        return denied(
            held.length === 0
                ? `The last committed change sets no value in ${request.unit}, so there is no value to continue.`
                : `The last committed change sets no value in ${request.unit}; its values are in ${held}.`
        );
    }
    const calls: ToolCallResult[] = [];
    const continuedFigures: ContinuedFigure[] = [];
    for (const committedValue of matching) {
        const { command } = committedValue;
        if (!targetsStand(command, context)) {
            return denied(
                `What the committed "${command.label}" acted on is no longer in the project, so it cannot be continued.`
            );
        }
        const continued = continuedCommittedValue(request, committedValue);
        if (continued.status === 'refused') {
            return continued.outcome;
        }
        const argument = committedValue.kind === 'pan' ? 'pan' : 'value';
        calls.push({ name: command.type, arguments: { ...readStatedArguments(command), [argument]: continued.value } });
        if (committedValue.kind === 'parameter') {
            continuedFigures.push({
                deviceId: String(command.payload.deviceId),
                paramId: committedValue.parameter.id,
                unit: committedValue.unit,
                figure: request.figure,
                comparative: request.comparative,
                committed: committedValue.value,
                landed: continued.value,
            });
        }
    }
    return groundContinuedCalls(calls, context, continuedFigures);
}

function formatDecibels(value: number): string {
    return `${String(roundToThousandths(value))} dB`;
}

/**
 * The value a continuation states for one committed level. A committed move continues as a move:
 * "more" (and "another") moves further the same way, "less" makes the committed move smaller by the
 * figure, from wherever the level is now. A committed level continues from that committed level,
 * never from where the fader is now: "more" lands higher, "less" lower, and "another" has no way
 * to go.
 */
function continuedLevel(request: FiguredRequest, committed: ProposalGroundingValue): ContinuedValue {
    const figure = request.figure;
    const stated = formatDecibels(figure);
    if (committed.form === 'absolute') {
        if (request.phrasing === 'another') {
            return {
                status: 'refused',
                outcome: clarify(
                    `"Another ${stated}" does not say which way the committed level of ${formatDecibels(committed.value)} should move.`,
                    `Should it go up or down? Say "${stated} more" or "${stated} less".`
                ),
            };
        }
        const value = request.comparative === 'more' ? committed.value + figure : committed.value - figure;
        return { status: 'value', value: roundToThousandths(value) };
    }
    const direction = Math.sign(committed.value);
    const size = Math.abs(committed.value);
    if (request.comparative === 'more') {
        return { status: 'value', value: direction * figure };
    }
    if (figure >= size) {
        return {
            status: 'refused',
            outcome: denied(
                figure === size
                    ? `"${stated} less" would take back the whole committed change of ${formatDecibels(size)}; say "undo that" to undo it.`
                    : `"${stated} less" is more than the committed change of ${formatDecibels(size)}, so it would reverse it rather than make it smaller.`
            ),
        };
    }
    return { status: 'value', value: -direction * figure };
}

/** A further level change on the committed targets, bound to the committed values. */
function continueCommittedLevels(
    request: FiguredRequest,
    committed: CommittedBatch,
    context: ProjectContext
): LastCommitContinuation {
    const { figure } = request;
    if (figure === 0) {
        return denied('A 0 dB change leaves every committed level where it is.');
    }
    const levels = readCommittedLevels(committed);
    if (levels.length === 0) {
        return denied('The last committed change sets no level in decibels, so there is no level to continue.');
    }
    if (new Set(levels.map((level) => level.value.form)).size > 1) {
        return clarify(
            'The last committed change moved some levels and set others, so a further change has no one reading.',
            'Which level should change, and by how much? Name it, as in "turn Vocals down 1 dB".'
        );
    }
    const calls: ToolCallResult[] = [];
    for (const { command, value } of levels) {
        if (!targetsStand(command, context)) {
            return denied(
                `What the committed "${command.label}" acted on is no longer in the project, so it cannot be continued.`
            );
        }
        const continued = continuedLevel(request, value);
        if (continued.status === 'refused') {
            return continued.outcome;
        }
        calls.push({
            name: command.type,
            arguments: { ...readStatedArguments(command), [value.argument]: continued.value },
        });
    }
    return groundContinuedCalls(calls, context);
}

/**
 * A comparative with no figure asks how much, in the unit the committed control shows: decibels for a
 * level, and otherwise the one unit the commit's pans and device parameters share.
 */
function askHowMuch(request: ContinueRequest, committed: CommittedBatch, context: ProjectContext) {
    const asked = `The request asks for ${request.comparative} without saying how much.`;
    const read = readCommittedLevels(committed).length > 0 ? null : readCommittedValues(committed, context);
    const units = read?.status === 'read' ? [...new Set(read.values.map((value) => value.unit))] : [];
    const [unit] = units;
    if (units.length !== 1 || unit === undefined) {
        return clarify(asked, `How many decibels ${request.comparative}? Say it as in "1 dB ${request.comparative}".`);
    }
    const example = `${formatInUnit(unit === '%' ? 10 : 1, unit)} ${request.comparative}`;
    return clarify(
        asked,
        `How much ${request.comparative}, in ${unit === '%' ? 'percent' : unit}? Say it as in "${example}".`
    );
}

/** A further change on the committed targets, bound to the committed values, in the figure's unit. */
export function continueCommittedChange(
    request: ContinueRequest,
    committed: CommittedBatch,
    context: ProjectContext
): LastCommitContinuation {
    const { figure, unit } = request;
    if (figure === null) {
        return askHowMuch(request, committed, context);
    }
    if (unit !== undefined) {
        return continueCommittedValues({ ...request, figure, unit }, committed, context);
    }
    // A device parameter declared in decibels (an EQ band's gain) is no level, so a decibel figure
    // continues it only where the commit sets no level of its own.
    const values = readCommittedValues(committed, context);
    if (
        readCommittedLevels(committed).length === 0 &&
        values.status === 'read' &&
        values.values.some((value) => sameUnit(value.unit, 'dB'))
    ) {
        return continueCommittedValues({ ...request, figure, unit: 'dB' }, committed, context);
    }
    return continueCommittedLevels({ ...request, figure }, committed, context);
}
