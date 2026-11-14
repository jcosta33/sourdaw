import { getBuiltinPlugins } from '#/modules/Arrangement/useCases';
import { undoHistoryStore } from '#/modules/Command/stores';
import {
    getExecutableAppActionGroundingCatalog,
    getExecutableAppActionGroundingRules,
} from '#/modules/Command/useCases';

import { type AdoptedRecipe } from '../models/AdoptedRecipe';
import { clarify, denied } from '../models/LastCommitRefusal';
import { type ProjectContext } from '../models/ProjectContext';
import { type ThreadContext } from '../models/ThreadContext';
import { agentRunStore } from '../stores/agentRunStore';
import { pendingActionConfirmationStore } from '../stores/pendingActionConfirmationStore';
import { type LastCommitRequest, readLastCommitRequest } from '../transformers/readLastCommitRequest';
import { type ToolCallResult } from '../transformers/toolCallParser';

import { normalizePromptText } from './agentReference/groundingStrategies/normalizePromptText';
import { resolveClauseActionIntent } from './agentReference/groundingStrategies/resolveClauseActionIntent';
import { isAgentReferenceCapabilityCandidate } from './agentReference/isAgentReferenceCapabilityCandidate';
import { readConfirmationBatchId } from './agentRequestOrchestration/readConfirmationBatchId';
import { continueCommittedChange } from './lastCommitContinuation/continueCommittedChange';
import { createsObjects } from './lastCommitContinuation/createsObjects';
import { groundContinuedCalls } from './lastCommitContinuation/groundContinuedCalls';
import {
    type CommittedBatch,
    type CommittedCommand,
    type LastCommitContinuation,
    type RetargetRequest,
} from './lastCommitContinuation/lastCommitOutcome';
import { readNamedTracks } from './lastCommitContinuation/readNamedTracks';
import { readRetargetTracks } from './lastCommitContinuation/readRetargetTracks';
import { readStatedArguments } from './lastCommitContinuation/readStatedArguments';
import { retargetCommittedRecipe } from './lastCommitContinuation/retargetCommittedRecipe';
import { trackName } from './lastCommitContinuation/trackName';

type FollowUpRequest = Exclude<LastCommitRequest, { kind: 'none' }>;
type ThreadCommit = NonNullable<ThreadContext['lastCommit']>;

const NONE: LastCommitContinuation = { status: 'none' };

const REQUESTED_ACT: Readonly<Record<FollowUpRequest['kind'], string>> = {
    undo: 'undo',
    continue: 'continue',
    retarget: 'repeat',
};

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
    if (commands.length === 0 || receipt === undefined) {
        return null;
    }
    return { runId: commit.runId, workId: receipt.workId, revertGroupId, commands };
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
