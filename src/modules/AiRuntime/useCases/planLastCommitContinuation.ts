import { undoHistoryStore } from '#/modules/Command/stores';
import {
    getExecutableAppActionEffect,
    getExecutableAppActionGroundingRules,
    getExecutableAppActionProviderSchema,
    isExecutableAppActionType,
} from '#/modules/Command/useCases';
import { createPunchRegionPatch } from '#/modules/Transport/useCases';

import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';
import { type ProjectContext } from '../models/ProjectContext';
import { type ProposalGroundingValue } from '../models/ProposalGroundingBasis';
import { type RuntimeAction } from '../models/RuntimeAction';
import { type ThreadContext } from '../models/ThreadContext';
import { agentRunStore } from '../stores/agentRunStore';
import { bridgeLlmToolCalls } from '../transformers/llmActionBridge';
import { type LastCommitRequest, readLastCommitRequest } from '../transformers/readLastCommitRequest';
import { type ToolCallResult } from '../transformers/toolCallParser';

import { getBestAgentReferenceNameRanges } from './agentReference/getBestAgentReferenceNameRanges';
import { isAgentReferenceCapabilityCandidate } from './agentReference/isAgentReferenceCapabilityCandidate';
import { proposalCommandShape } from './agentReference/proposalCommandShape';

/**
 * What the planner makes of a chat request that continues, undoes or re-targets the thread's last
 * commit: `none` when the request is no such thing (or a pending card owns it), and it is planned as
 * any request; otherwise the application compiles the outcome itself from the committed batch.
 */
export type LastCommitContinuation =
    | { status: 'none' }
    | { status: 'actions'; actions: RuntimeAction[] }
    | { status: 'revert'; runId: string; revertGroupId: string }
    | { status: 'clarify'; reason: string; questions: string[] }
    | { status: 'denied'; reason: string };

type FollowUpRequest = Exclude<LastCommitRequest, { kind: 'none' }>;
type ContinueRequest = Extract<LastCommitRequest, { kind: 'continue' }>;
type RetargetRequest = Extract<LastCommitRequest, { kind: 'retarget' }>;
type ThreadCommit = NonNullable<ThreadContext['lastCommit']>;

/** One command of the committed batch, as the undo history holds it applied. */
type CommittedCommand = { type: string; payload: Record<string, unknown>; label: string };

type CommittedBatch = { runId: string; revertGroupId: string; commands: CommittedCommand[] };

const NONE: LastCommitContinuation = { status: 'none' };

const REQUESTED_ACT: Readonly<Record<FollowUpRequest['kind'], string>> = {
    undo: 'undo',
    continue: 'continue',
    retarget: 'repeat',
};

/** Words a list of track names may hold besides the names themselves. */
const TARGET_LIST_WORDS: ReadonlySet<string> = new Set(['the', 'and', '&', 'both', 'track', 'tracks']);

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
    return commands.length === 0 ? null : { runId: commit.runId, revertGroupId, commands };
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

function roundDecibels(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function formatDecibels(value: number): string {
    return `${String(roundDecibels(value))} dB`;
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
        return { status: 'value', value: roundDecibels(value) };
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

function compileCalls(calls: readonly ToolCallResult[], context: ProjectContext): LastCommitContinuation {
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
    return { status: 'actions', actions: converted.actions };
}

/** A further level change on the committed targets, bound to the committed values. */
function continueCommittedLevels(
    request: ContinueRequest,
    committed: CommittedBatch,
    context: ProjectContext
): LastCommitContinuation {
    const { figure } = request;
    if (figure === null) {
        return clarify(
            `The request asks for ${request.comparative} without saying how much.`,
            `How many decibels ${request.comparative}? Say it as in "1 dB ${request.comparative}".`
        );
    }
    if (figure === 0) {
        return denied('A 0 dB change leaves every committed level where it is.');
    }
    const levels = committed.commands.flatMap((command) => {
        const value = proposalCommandShape.value(command.type, command.payload);
        return value?.unit === 'dB' && !createsObjects(command.type) ? [{ command, value }] : [];
    });
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
    return compileCalls(calls, context);
}

type NamedTracks =
    { status: 'named'; ids: string[] } | { status: 'ambiguous'; text: string; names: string[] } | { status: 'unread' };

/**
 * The tracks the text names by whole name, in either grammatical number, through the shared
 * resolver's own reading, and nothing else: any word besides the names and the list's own joiners
 * leaves it unread, and a stretch two tracks' names read equally well is ambiguous.
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
    if (ranges.length === 0 || words.some((word) => !TARGET_LIST_WORDS.has(word))) {
        return { status: 'unread' };
    }
    return { status: 'named', ids: [...new Set(ranges.map((range) => range.id))] };
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

/** The committed batch, command for command, on the tracks the request names instead of the committed ones. */
function retargetCommittedChange(
    request: RetargetRequest,
    committed: CommittedBatch,
    context: ProjectContext
): LastCommitContinuation {
    const named = readNamedTracks(request.targetText, context);
    if (named.status === 'ambiguous') {
        return clarify(
            `"${named.text}" names more than one track.`,
            `Which track should take the last change: ${named.names.join(' or ')}?`
        );
    }
    if (named.status === 'unread') {
        return clarify(
            `"${request.targetText}" is not a list of this project's tracks.`,
            'Which tracks should take the last change? Name them, as in "do the same to Bass and Keys".'
        );
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
    return compileCalls(calls, context);
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
}): LastCommitContinuation {
    const request = readLastCommitRequest(input.prompt);
    if (request.kind === 'none' || (input.thread?.pendingProposal ?? null) !== null) {
        return NONE;
    }
    // "mute Bass too" is a request of its own, never a re-target, whatever the thread holds: only a
    // `too` list of this project's tracks says it repeats the last change.
    if (
        request.kind === 'retarget' &&
        request.form === 'too' &&
        readNamedTracks(request.targetText, input.context).status === 'unread'
    ) {
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
        return continueCommittedLevels(request, committed, input.context);
    }
    return retargetCommittedChange(request, committed, input.context);
}
