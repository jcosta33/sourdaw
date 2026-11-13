import { getBuiltinPlugins, getMixRecipeCatalog, quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';
import { undoHistoryStore } from '#/modules/Command/stores';
import {
    getExecutableAppActionEffect,
    getExecutableAppActionGroundingCatalog,
    getExecutableAppActionGroundingRules,
    getExecutableAppActionProviderSchema,
    isExecutableAppActionType,
} from '#/modules/Command/useCases';
import { createPunchRegionPatch } from '#/modules/Transport/useCases';
import { roundToThousandths } from '#/utils/Math/roundToThousandths';

import { type AdoptedRecipe } from '../models/AdoptedRecipe';
import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';
import { type ProjectContext, type ProjectContextDeviceParameter } from '../models/ProjectContext';
import { type ProposalGroundingValue } from '../models/ProposalGroundingBasis';
import { type RuntimeAction } from '../models/RuntimeAction';
import { type ThreadContext } from '../models/ThreadContext';
import { agentRunStore } from '../stores/agentRunStore';
import { pendingActionConfirmationStore } from '../stores/pendingActionConfirmationStore';
import { bridgeLlmToolCalls } from '../transformers/llmActionBridge';
import { type LastCommitRequest, readLastCommitRequest } from '../transformers/readLastCommitRequest';
import { type ToolCallResult } from '../transformers/toolCallParser';

import { getBestAgentReferenceNameRanges } from './agentReference/getBestAgentReferenceNameRanges';
import { normalizePromptText } from './agentReference/groundingStrategies/normalizePromptText';
import { resolveClauseActionIntent } from './agentReference/groundingStrategies/resolveClauseActionIntent';
import { isAgentReferenceCapabilityCandidate } from './agentReference/isAgentReferenceCapabilityCandidate';
import { proposalCommandShape } from './agentReference/proposalCommandShape';
import { readConfirmationBatchId } from './agentRequestOrchestration/readConfirmationBatchId';
import { expandMixRecipe } from './expandMixRecipe';
import { groundApplicationRecipeBatch } from './groundApplicationRecipeBatch';

type GroundedRecipeBatch = Extract<ReturnType<typeof groundApplicationRecipeBatch>, { status: 'grounded' }>;

/**
 * What the planner makes of a chat request that continues, undoes or re-targets the thread's last
 * commit: `none` when the request is no such thing (or a pending card owns it), and it is planned as
 * any request; otherwise the application compiles the outcome itself from the committed batch, or,
 * for a commit that adopted a recipe, re-expands that recipe on the tracks the request names.
 */
export type LastCommitContinuation =
    | { status: 'none' }
    | { status: 'actions'; actions: RuntimeAction[]; continuedFigures?: ContinuedFigure[] }
    | {
          status: 'recipe';
          grounded: GroundedRecipeBatch['grounded'];
          adoptedRecipes: AdoptedRecipe[];
          creativeAuthority: GroundedRecipeBatch['creativeAuthority'];
      }
    | { status: 'revert'; runId: string; revertGroupId: string }
    | { status: 'clarify'; reason: string; questions: string[] }
    | { status: 'denied'; reason: string };

/**
 * A device parameter value a continuation compiled from the request's figure: the planner accounts
 * the figure against the action that sets `landed`, the committed value moved by it.
 */
export type ContinuedFigure = {
    deviceId: string;
    paramId: string;
    unit: string;
    figure: number;
    comparative: 'more' | 'less';
    committed: number;
    landed: number;
};

type FollowUpRequest = Exclude<LastCommitRequest, { kind: 'none' }>;
type ContinueRequest = Extract<LastCommitRequest, { kind: 'continue' }>;
type RetargetRequest = Extract<LastCommitRequest, { kind: 'retarget' }>;
type ThreadCommit = NonNullable<ThreadContext['lastCommit']>;

/** One command of the committed batch, as the undo history holds it applied. */
type CommittedCommand = { type: string; payload: Record<string, unknown>; label: string };

type CommittedBatch = { runId: string; workId: string; revertGroupId: string; commands: CommittedCommand[] };

/** Names the authority and retained expansions of a recipe repeated from the last commit. */
const RECIPE_RETARGET_ORIGIN = 'last-commit-recipe';

/** The commands a recipe expansion lowers to; a committed batch holding any other is more than its recipe. */
const RECIPE_COMMAND_TYPES: ReadonlySet<string> = new Set(['addDevice', 'setDeviceParameter']);

/**
 * The pan field's full scale on either side, as `setTrackPan` declares it ("-50 to 50") and the
 * action bridge holds it. The mixer strip shows that field as it stands (`L20` for -20), and a request
 * reads a pan percentage as that same figure ("pan Vocals 20% left" grounds to -20), so a continuation
 * figure in percent moves the field by exactly that figure.
 */
const PAN_LIMIT = 50;

const NONE: LastCommitContinuation = { status: 'none' };

const REQUESTED_ACT: Readonly<Record<FollowUpRequest['kind'], string>> = {
    undo: 'undo',
    continue: 'continue',
    retarget: 'repeat',
};

/** Words a list of track names may hold besides the names themselves. */
const TARGET_LIST_WORDS: ReadonlySet<string> = new Set(['the', 'and', '&', 'both', 'track', 'tracks']);

/** Words that join two names of a list; a comma joins them too. */
const LIST_JOINERS: ReadonlySet<string> = new Set(['and', '&']);

/**
 * Every unit a built-in device parameter declares, as its descriptor spells it: the closed list a
 * continuation figure outside decibels and percent may be stated in.
 */
function readDeclaredParameterUnits(): string[] {
    return [
        ...new Set(
            getBuiltinPlugins().flatMap((plugin) =>
                plugin.parameters.map((parameter) => parameter.unit).filter((unit) => unit.trim().length > 0)
            )
        ),
    ];
}

function denied(reason: string): LastCommitContinuation {
    return { status: 'denied', reason };
}

function clarify(reason: string, question: string): LastCommitContinuation {
    return { status: 'clarify', reason, questions: [question] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Only a commit whose whole revert group the undo history holds applied has committed values to
 * work from: an undone one has none in the project, and one of unknown standing may hold only part.
 */
function refuseUnlessStanding(commit: ThreadCommit, request: FollowUpRequest): LastCommitContinuation | null {
    if (commit.standing === 'standing') {
        return null;
    }
    if (commit.standing === 'undone') {
        return denied(
            request.kind === 'undo'
                ? 'The last committed change is already undone; there is nothing more to undo.'
                : `The last committed change was undone, so there is no committed change to ${REQUESTED_ACT[request.kind]}.`
        );
    }
    return denied(
        `The undo history no longer shows whether the last committed change still stands as committed, so it cannot ${REQUESTED_ACT[request.kind]} it.`
    );
}

/** The committed batch as the undo history holds it: every entry of the commit's revert group, in order. */
function readCommittedBatch(commit: ThreadCommit): CommittedBatch | null {
    const run = agentRunStore.value?.runs.find((candidate) => candidate.runId === commit.runId);
    const receipt = run?.receipts.find((candidate) => commit.receiptIds.includes(candidate.receiptIdentity));
    const revertGroupId = receipt?.revertGroupId ?? null;
    if (revertGroupId === null) {
        return null;
    }
    const entries = (undoHistoryStore.value?.past ?? []).filter((entry) => entry.groupId === revertGroupId);
    const commands: CommittedCommand[] = [];
    for (const entry of entries) {
        if (entry.kind !== 'action') {
            return null;
        }
        const payload = 'payload' in entry.action && isRecord(entry.action.payload) ? entry.action.payload : {};
        commands.push({ type: entry.action.type, payload, label: entry.label });
    }
    return commands.length === 0 || receipt === undefined
        ? null
        : { runId: commit.runId, workId: receipt.workId, revertGroupId, commands };
}

/**
 * The recipes the committed batch adopted, as its confirmation's approval snapshot recorded them: the
 * confirmation of the commit's run whose command batch is the receipt's work. A direct commit has no
 * confirmation and adopted none.
 */
function readCommittedRecipes(committed: CommittedBatch): readonly AdoptedRecipe[] {
    const confirmation = (pendingActionConfirmationStore.value?.confirmations ?? []).find(
        (candidate) => candidate.runId === committed.runId && readConfirmationBatchId(candidate) === committed.workId
    );
    return confirmation?.approvalSnapshot.adoptedRecipes ?? [];
}

/** The arguments a provider may state for the command, as committed: never a guard the application added. */
function readStatedArguments(command: CommittedCommand): Record<string, unknown> {
    if (!isExecutableAppActionType(command.type)) {
        return {};
    }
    const declared = getExecutableAppActionProviderSchema(command.type).properties;
    return Object.fromEntries(
        Object.entries(command.payload).filter(([argument]) => Object.hasOwn(declared, argument))
    );
}

function createsObjects(actionType: string): boolean {
    return (getExecutableAppActionEffect(actionType)?.creates ?? []).length > 0;
}

/** Whether every object the committed command acted on is still in the project, as its target rule reads it. */
function targetsStand(command: CommittedCommand, context: ProjectContext): boolean {
    return proposalCommandShape
        .targetObjects(command.type, command.payload)
        .every((target) =>
            isAgentReferenceCapabilityCandidate({ capability: target.capability, context, id: target.id })
        );
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
function continuedValue(
    request: ContinueRequest & { figure: number },
    committed: ProposalGroundingValue
): { status: 'value'; value: number } | { status: 'refused'; outcome: LastCommitContinuation } {
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

function groundContinuedCalls(
    calls: readonly ToolCallResult[],
    context: ProjectContext,
    continuedFigures: ContinuedFigure[] = []
): LastCommitContinuation {
    if (calls.length > MAX_LLM_ACTIONS_PER_BATCH) {
        return denied(
            `Repeating the last committed change there takes ${String(calls.length)} commands, more than one batch of ${String(MAX_LLM_ACTIONS_PER_BATCH)} holds.`
        );
    }
    const converted = bridgeLlmToolCalls({ calls, context, projectPunchRegion: createPunchRegionPatch });
    const [rejection] = converted.rejections;
    if (rejection !== undefined) {
        return denied(`The continued ${rejection.name} could not be compiled: ${rejection.reason}.`);
    }
    return {
        status: 'actions',
        actions: converted.actions,
        ...(continuedFigures.length === 0 ? {} : { continuedFigures }),
    };
}

/** The committed levels in decibels of commands that create nothing, each with its committed value. */
function readCommittedLevels(committed: CommittedBatch) {
    return committed.commands.flatMap((command) => {
        const value = proposalCommandShape.value(command.type, command.payload);
        return value?.unit === 'dB' && !createsObjects(command.type) ? [{ command, value }] : [];
    });
}

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

type ContinuedValue = { status: 'value'; value: number } | { status: 'refused'; outcome: LastCommitContinuation };

/**
 * The pan a continuation lands on, from the committed pan, never where the knob is now: "another" and
 * "more" move further toward the committed side, "less" back toward the centre. A centred pan has no
 * side to move toward, and a pan that would pass the limit or cross the centre is refused, never
 * clamped.
 */
function continuedPan(request: ContinueRequest & { figure: number }, committed: number): ContinuedValue {
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
        return { status: 'value', value: roundToThousandths(side * (size - request.figure)) };
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
    request: ContinueRequest & { figure: number },
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

/** The units the committed batch states values in, as a reason names them. */
function describeCommittedUnits(committed: CommittedBatch, values: readonly CommittedValue[]): string {
    const units = [
        ...(readCommittedLevels(committed).length > 0 ? ['dB'] : []),
        ...values.map((value) =>
            value.kind === 'pan'
                ? 'percent (pan)'
                : `${value.unit.trim().length === 0 ? 'no unit' : value.unit} (${value.parameter.name})`
        ),
    ];
    return [...new Set(units)].join(', ');
}

/** A further change of the committed pans and device parameters stated in the figure's unit. */
function continueCommittedValues(
    request: ContinueRequest & { figure: number; unit: string },
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
        const continued =
            committedValue.kind === 'pan'
                ? continuedPan(request, committedValue.value)
                : continuedParameter(request, committedValue);
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
function continueCommittedChange(
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

/** A further level change on the committed targets, bound to the committed values. */
function continueCommittedLevels(
    request: ContinueRequest & { figure: number },
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
        const continued = continuedValue({ ...request, figure }, value);
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

type NamedTracks =
    { status: 'named'; ids: string[] } | { status: 'ambiguous'; text: string; names: string[] } | { status: 'unread' };

/** Whether a joiner stands between every two names, as a list of names needs: "Bass and Keys", never "Bass Keys". */
function joinsEveryName(text: string, ranges: ReadonlyArray<{ start: number; end: number }>): boolean {
    return ranges.slice(1).every((range, index) => {
        const between = text.slice(ranges[index]!.end, range.start).toLowerCase();
        return between.includes(',') || between.split(/\s+/u).some((word) => LIST_JOINERS.has(word));
    });
}

/**
 * The tracks the text names by whole name, in either grammatical number, through the shared
 * resolver's own reading, and nothing else: any word besides the names and the list's own joiners,
 * or two names with no joiner between them, leaves it unread, and a stretch two tracks' names read
 * equally well is ambiguous.
 */
function readNamedTracks(text: string, context: ProjectContext): NamedTracks {
    const tracks = context.tracks.map((track) => ({ id: track.id, name: track.name }));
    const ranges = getBestAgentReferenceNameRanges(text, tracks, 'with-number-forms').toSorted(
        (left, right) => left.start - right.start || left.end - right.end
    );
    for (const [index, range] of ranges.entries()) {
        const next = ranges[index + 1];
        if (next !== undefined && next.start < range.end) {
            const shared = ranges.filter((candidate) => candidate.start < range.end && candidate.end > range.start);
            return {
                status: 'ambiguous',
                text: text.slice(range.start, Math.max(range.end, next.end)),
                names: [
                    ...new Set(
                        shared.map((candidate) => tracks.find((track) => track.id === candidate.id)?.name ?? '')
                    ),
                ],
            };
        }
    }
    let rest = text;
    for (const range of ranges) {
        rest = `${rest.slice(0, range.start)}${' '.repeat(range.end - range.start)}${rest.slice(range.end)}`;
    }
    const words = rest
        .toLowerCase()
        .split(/[\s,]+/u)
        .filter((word) => word.length > 0);
    if (ranges.length === 0 || words.some((word) => !TARGET_LIST_WORDS.has(word)) || !joinsEveryName(text, ranges)) {
        return { status: 'unread' };
    }
    return { status: 'named', ids: [...new Set(ranges.map((range) => range.id))] };
}

/**
 * Whether a `too` list opens on a word the action catalog reads as an action, with something after
 * it to act on ("solo Bass too"): a request of its own, even where a track carries that word as its
 * name. A list that is the action word alone gives the action nothing to act on, so it reads only as
 * the track of that name ("mute too" beside a track called Mute).
 */
function opensOnAction(targetText: string): boolean {
    const intent = resolveClauseActionIntent(targetText, getExecutableAppActionGroundingCatalog());
    return (
        intent !== null && intent.index === 0 && normalizePromptText(targetText) !== normalizePromptText(intent.phrase)
    );
}

/** Whether a `too` list is a request of its own rather than a list of this project's tracks. */
function isOwnTooRequest(targetText: string, context: ProjectContext): boolean {
    return opensOnAction(targetText) || readNamedTracks(targetText, context).status === 'unread';
}

/** The one track target a committed command may be moved to, or `null` when it acts on anything else. */
function readTrackTargetRule(command: CommittedCommand) {
    const targetRules = getExecutableAppActionGroundingRules(command.type)?.targetRules ?? [];
    const trackRule = targetRules.find((rule) => rule.argument === 'trackId');
    if (trackRule === undefined || targetRules.length > 1 || createsObjects(command.type)) {
        return null;
    }
    return trackRule;
}

function trackName(id: string, context: ProjectContext): string {
    return context.tracks.find((track) => track.id === id)?.name ?? id;
}

type ReadTargets = { status: 'named'; ids: string[] } | { status: 'refused'; outcome: LastCommitContinuation };

/** The tracks a re-target names, or the question a stretch it cannot read as tracks asks. */
function readRetargetTracks(request: RetargetRequest, context: ProjectContext): ReadTargets {
    const named = readNamedTracks(request.targetText, context);
    if (named.status === 'ambiguous') {
        return {
            status: 'refused',
            outcome: clarify(
                `"${named.text}" names more than one track.`,
                `Which track should take the last change: ${named.names.join(' or ')}?`
            ),
        };
    }
    if (named.status === 'unread') {
        return {
            status: 'refused',
            outcome: clarify(
                `"${request.targetText}" is not a list of this project's tracks.`,
                'Which tracks should take the last change? Name them, as in "do the same to Bass and Keys".'
            ),
        };
    }
    return named;
}

/**
 * Whether the catalogue still publishes the committed recipe as the commit expanded it: a recipe it no
 * longer lists, or one published from a factory preset whose version has changed since, would repeat
 * something other than what was committed.
 */
function findRecipeChange(adopted: AdoptedRecipe): string | null {
    const recipe = getMixRecipeCatalog().recipes.find((candidate) => candidate.id === adopted.recipeId);
    if (recipe === undefined) {
        return `The recipe the last committed change applied, "${adopted.title}", is no longer in the recipe catalogue, so it cannot be repeated.`;
    }
    if (recipe.origin?.presetVersion !== adopted.presetVersion) {
        return `The factory preset behind the recipe the last committed change applied, "${adopted.title}", has changed since that change, so repeating it would not apply the same recipe.`;
    }
    return null;
}

/**
 * The committed recipe expanded again on each named track, through the one expansion path and
 * against the planning context, so each expansion mints its own devices and never reuses the
 * committed track's. Every refusal names its reason, and the whole re-target is refused when any
 * named track cannot take the recipe.
 */
function retargetCommittedRecipe(input: {
    request: RetargetRequest;
    committed: CommittedBatch;
    adopted: AdoptedRecipe;
    context: ProjectContext;
    projectRevision: string;
    prompt: string;
}): LastCommitContinuation {
    const { adopted, committed, context } = input;
    const other = committed.commands.find((command) => !RECIPE_COMMAND_TYPES.has(command.type));
    if (other !== undefined) {
        return denied(
            `The last committed change holds "${other.label}" beside its recipe, so it cannot be repeated as the recipe alone.`
        );
    }
    const targets = readRetargetTracks(input.request, context);
    if (targets.status === 'refused') {
        return targets.outcome;
    }
    const recipeChange = findRecipeChange(adopted);
    if (recipeChange !== null) {
        return denied(recipeChange);
    }
    if (targets.ids.includes(adopted.targetId)) {
        return denied(`${trackName(adopted.targetId, context)} already took the last committed change.`);
    }
    const frozen = targets.ids.find((id) => context.tracks.find((track) => track.id === id)?.frozen === true);
    if (frozen !== undefined) {
        return denied(
            `${trackName(frozen, context)} is frozen, so the recipe "${adopted.title}" cannot be applied to it until it is unfrozen.`
        );
    }
    let commandCount = 0;
    for (const [ordinal, id] of targets.ids.entries()) {
        const expanded = expandMixRecipe(
            { recipeId: adopted.recipeId, targetId: id, role: null, values: [] },
            context,
            ordinal
        );
        if (expanded.status === 'refused') {
            return denied(`${trackName(id, context)} cannot take the recipe "${adopted.title}": ${expanded.reason}`);
        }
        commandCount += expanded.commands.length;
    }
    if (commandCount > MAX_LLM_ACTIONS_PER_BATCH) {
        return denied(
            `Repeating the last committed change there takes ${String(commandCount)} commands, more than one batch of ${String(MAX_LLM_ACTIONS_PER_BATCH)} holds.`
        );
    }
    const [first, ...rest] = targets.ids.map((targetId) => ({ recipeId: adopted.recipeId, targetId, role: null }));
    if (first === undefined) {
        return denied('The request names no track to apply the recipe to.');
    }
    const batch = groundApplicationRecipeBatch({
        origin: RECIPE_RETARGET_ORIGIN,
        pairs: [first, ...rest],
        context,
        projectRevision: input.projectRevision,
        prompt: input.prompt,
    });
    switch (batch.status) {
        case 'refused-expansion':
            return denied(
                `${trackName(batch.pair.targetId, context)} cannot take the recipe "${adopted.title}": ${batch.reason}`
            );
        case 'rejected':
            return denied(`The repeated recipe could not be compiled: ${batch.reason}`);
        case 'not-compiled':
            return denied('The repeated recipe did not compile to a change for this project.');
        case 'grounded':
            return {
                status: 'recipe',
                grounded: batch.grounded,
                adoptedRecipes: batch.adoptedRecipes,
                creativeAuthority: batch.creativeAuthority,
            };
        default: {
            const exhaustive: never = batch;
            throw new Error(`Unsupported application recipe batch result: ${JSON.stringify(exhaustive)}`);
        }
    }
}

/**
 * A re-target of the committed change: the committed recipe re-expanded when the commit adopted
 * exactly one, a question when it adopted several, and otherwise the committed batch command for
 * command — except that a request naming the recipe, when the commit adopted none, is refused.
 */
function retargetLastCommit(input: {
    request: RetargetRequest;
    committed: CommittedBatch;
    context: ProjectContext;
    projectRevision: string;
    prompt: string;
}): LastCommitContinuation {
    const recipes = readCommittedRecipes(input.committed);
    const [only] = recipes;
    if (recipes.length > 1) {
        return clarify(
            `The last committed change applied ${String(recipes.length)} recipes, so repeating "the recipe" has no one reading.`,
            `Which recipe should be repeated: ${recipes.map((recipe) => `"${recipe.title}"`).join(' or ')}? Name it and the track it goes on.`
        );
    }
    if (only !== undefined) {
        return retargetCommittedRecipe({ ...input, adopted: only });
    }
    if (input.request.form === 'recipe') {
        return denied('The last committed change applied no recipe, so there is no recipe to repeat.');
    }
    return retargetCommittedChange(input.request, input.committed, input.context);
}

/** The committed batch, command for command, on the tracks the request names instead of the committed ones. */
function retargetCommittedChange(
    request: RetargetRequest,
    committed: CommittedBatch,
    context: ProjectContext
): LastCommitContinuation {
    const named = readRetargetTracks(request, context);
    if (named.status === 'refused') {
        return named.outcome;
    }
    const movable: Array<{ command: CommittedCommand; rule: NonNullable<ReturnType<typeof readTrackTargetRule>> }> = [];
    for (const command of committed.commands) {
        const rule = readTrackTargetRule(command);
        if (rule === null) {
            return denied(
                `The last committed change holds "${command.label}", which acts on something other than one track's own setting, so it cannot be repeated on other tracks.`
            );
        }
        movable.push({ command, rule });
    }
    const committedTrackIds = new Set(committed.commands.map((command) => command.payload.trackId));
    const repeated = named.ids.find((id) => committedTrackIds.has(id));
    if (repeated !== undefined) {
        return denied(`${trackName(repeated, context)} already took the last committed change.`);
    }
    const calls: ToolCallResult[] = [];
    for (const id of named.ids) {
        for (const { command, rule } of movable) {
            if (!isAgentReferenceCapabilityCandidate({ capability: rule.capability, context, id })) {
                return denied(`${trackName(id, context)} cannot take the committed "${command.label}".`);
            }
            calls.push({ name: command.type, arguments: { ...readStatedArguments(command), [rule.argument]: id } });
        }
    }
    return groundContinuedCalls(calls, context);
}

/**
 * Reads a chat request against the thread's last commit, and compiles what it asks from the
 * committed batch itself: a further level change bound to the committed values, the same change on
 * other tracks, or that commit's group undo. A thread with a pending proposal leaves the request to
 * that card's refinement, and a request outside the closed grammar is planned as any request.
 */
export function planLastCommitContinuation(input: {
    prompt: string;
    context: ProjectContext;
    thread: ThreadContext | null;
    /** The revision the planning context was read at, which a re-expanded recipe is grounded against. */
    projectRevision?: string;
}): LastCommitContinuation {
    const request = readLastCommitRequest(input.prompt, readDeclaredParameterUnits());
    if (request.kind === 'none' || (input.thread?.pendingProposal ?? null) !== null) {
        return NONE;
    }
    // "mute Bass too" is a request of its own, never a re-target, whatever the thread holds: only a
    // `too` list of this project's tracks, led by no action, says it repeats the last change.
    if (request.kind === 'retarget' && request.form === 'too' && isOwnTooRequest(request.targetText, input.context)) {
        return NONE;
    }
    const commit = input.thread?.lastCommit ?? null;
    if (commit === null) {
        return denied(`This chat has no committed change to ${REQUESTED_ACT[request.kind]}.`);
    }
    const standingRefusal = refuseUnlessStanding(commit, request);
    if (standingRefusal !== null) {
        return standingRefusal;
    }
    const committed = readCommittedBatch(commit);
    if (committed === null) {
        return denied(
            `The undo history no longer holds the last committed change as one group, so it cannot ${REQUESTED_ACT[request.kind]} it.`
        );
    }
    if (request.kind === 'undo') {
        return { status: 'revert', runId: committed.runId, revertGroupId: committed.revertGroupId };
    }
    if (request.kind === 'continue') {
        return continueCommittedChange(request, committed, input.context);
    }
    return retargetLastCommit({
        request,
        committed,
        context: input.context,
        projectRevision: input.projectRevision ?? '',
        prompt: input.prompt,
    });
}
