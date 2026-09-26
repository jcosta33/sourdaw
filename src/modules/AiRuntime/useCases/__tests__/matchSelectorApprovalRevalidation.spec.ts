import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    compileVersionedCommandBatchEnvelope,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    resetActionReplayAuthority,
    serializeVersionedCommandEnvelope,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectIdentity,
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { type SemanticCommandListMatchSelectorRecord } from '../../models/SemanticCommandList';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getProjectContext } from '../getProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';
import { reproposePendingChatActions } from '../reproposePendingChatActions';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const DEFAULT_TRACK_COLOR = '#ffffff';
const DRUM_COLOR = '#ff5500';
const DRUM_AUTOMATION_MODE = 'write';

function createColorableTrack(id: string, name: string): Track {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: DEFAULT_TRACK_COLOR,
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function setTracks(tracks: Track[]): void {
    trackStore.set({ tracks, selectedTrackId: tracks[0]?.id ?? null, ghostClips: [] });
    flushAutomergeStorageWrites();
}

function trackIdsOf(actions: readonly ExecutableRuntimeAction[]): string[] {
    return actions.flatMap((action) => (action.type === 'setTrackColor' ? [action.payload.trackId] : []));
}

function buildDrumColorCall() {
    return [
        {
            name: 'command.batch.propose',
            arguments: {
                plan: {
                    semantic: { classification: 'simple' as const, uncertainty: [] },
                    objective: 'Color every drum-family track red.',
                    constraints: ['Do not create, delete, or rename any track.'],
                    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                    capabilityIds: ['setTrackColor'],
                    assetIds: [],
                    alternatives: [],
                    validationStrategy: [
                        'Resolve every drum-family track through the live selector before coloring it.',
                    ],
                    stoppingConditions: ['Stop if the selector resolves more than its maximum of 8 tracks.'],
                },
                list: {
                    schemaVersion: 1,
                    items: [
                        {
                            id: 'color-drums',
                            name: 'setTrackColor',
                            arguments: { color: DRUM_COLOR },
                            selector: {
                                targetArgument: 'trackId',
                                entity: 'track',
                                match: { all: [{ roleFamily: 'drums' }] },
                                quantity: { unit: 'targets', maximum: 8 },
                            },
                        },
                    ],
                },
            },
        },
    ];
}

/**
 * Compiles the bulk `roleFamily: drums` `setTrackColor` proposal directly through the compiler,
 * against the live project, the same way `parsePromptToActions` does — including the carried
 * `matchSelectorPredicates` evidence `resolveConfirmationAdmission` re-resolves before an approval
 * rebind.
 */
function compileDrumColorProposal(): {
    actions: ExecutableRuntimeAction[];
    matchSelectorPredicates: SemanticCommandListMatchSelectorRecord[];
    revision: string;
} {
    const context = getProjectContext();
    const revision = captureProjectRevision();
    const compiled = compileArbitraryCommandList({ context, revision, calls: buildDrumColorCall() });
    if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
        const reason = compiled.status === 'rejected' ? compiled.reason : 'missing compiler evidence';
        throw new Error(`Expected the drum color batch to compile: ${reason}`);
    }
    const unguardedActions = compiled.compilerEvidence.commands.map((command) => {
        if (
            command.name !== 'setTrackColor' ||
            typeof command.arguments.trackId !== 'string' ||
            typeof command.arguments.color !== 'string'
        ) {
            throw new Error('Expected a canonical setTrackColor command.');
        }
        return {
            type: 'setTrackColor' as const,
            payload: { trackId: command.arguments.trackId, color: command.arguments.color },
        };
    });
    const materialized = materializeActionStateGuards(unguardedActions, context);
    if (materialized.status !== 'accepted') {
        throw new Error(materialized.reason);
    }
    const matchSelectorPredicates: SemanticCommandListMatchSelectorRecord[] =
        compiled.compilerEvidence.selectors.flatMap((selector) => {
            if (selector.predicate === undefined) {
                return [];
            }
            return [
                {
                    itemId: selector.itemId,
                    entity: selector.predicate.entity,
                    where: selector.predicate.where,
                    match: selector.predicate.match,
                    condition: selector.predicate.condition,
                    excludeIds: selector.predicate.excludeIds,
                    quantity: selector.predicate.quantity,
                    stableIds: [...selector.stableIds],
                },
            ];
        });
    return { actions: materialized.actions, matchSelectorPredicates, revision };
}

function buildDrumAutomationModeCall() {
    return [
        {
            name: 'command.batch.propose',
            arguments: {
                plan: {
                    semantic: { classification: 'simple' as const, uncertainty: [] },
                    objective: 'Put every drum-family track into automation write mode.',
                    constraints: ['Do not create, delete, or rename any track.'],
                    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                    capabilityIds: ['setAutomationMode'],
                    assetIds: [],
                    alternatives: [],
                    validationStrategy: [
                        'Resolve every drum-family track through the live selector before changing its automation mode.',
                    ],
                    stoppingConditions: ['Stop if the selector resolves more than its maximum of 8 tracks.'],
                },
                list: {
                    schemaVersion: 1,
                    items: [
                        {
                            id: 'automation-drums',
                            name: 'setAutomationMode',
                            arguments: { mode: DRUM_AUTOMATION_MODE },
                            selector: {
                                targetArgument: 'trackId',
                                entity: 'track',
                                match: { all: [{ roleFamily: 'drums' }] },
                                quantity: { unit: 'targets', maximum: 8 },
                            },
                        },
                    ],
                },
            },
        },
    ];
}

/**
 * `setTrackColor` cannot execute inside `previewVersionedCommandBatchEnvelope`'s isolated preview
 * workspace, so a subset re-preview of a `setTrackColor` batch always rejects (`Action cannot execute
 * inside an isolated preview: setTrackColor`) before it ever reaches the selector-coverage filter a
 * subset repropose test needs to exercise. `setAutomationMode` is a single-target track action that
 * does support isolated preview, so it stands in wherever a test drives the real subset route.
 */
function compileDrumAutomationModeProposal(): {
    actions: ExecutableRuntimeAction[];
    matchSelectorPredicates: SemanticCommandListMatchSelectorRecord[];
    revision: string;
} {
    const context = getProjectContext();
    const revision = captureProjectRevision();
    const compiled = compileArbitraryCommandList({ context, revision, calls: buildDrumAutomationModeCall() });
    if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
        const reason = compiled.status === 'rejected' ? compiled.reason : 'missing compiler evidence';
        throw new Error(`Expected the drum automation-mode batch to compile: ${reason}`);
    }
    const actions: ExecutableRuntimeAction[] = compiled.compilerEvidence.commands.map((command) => {
        if (
            command.name !== 'setAutomationMode' ||
            typeof command.arguments.trackId !== 'string' ||
            typeof command.arguments.mode !== 'string'
        ) {
            throw new Error('Expected a canonical setAutomationMode command.');
        }
        return {
            type: 'setAutomationMode' as const,
            payload: { trackId: command.arguments.trackId, mode: command.arguments.mode as Track['automationMode'] },
        };
    });
    const matchSelectorPredicates: SemanticCommandListMatchSelectorRecord[] =
        compiled.compilerEvidence.selectors.flatMap((selector) => {
            if (selector.predicate === undefined) {
                return [];
            }
            return [
                {
                    itemId: selector.itemId,
                    entity: selector.predicate.entity,
                    where: selector.predicate.where,
                    match: selector.predicate.match,
                    condition: selector.predicate.condition,
                    excludeIds: selector.predicate.excludeIds,
                    quantity: selector.predicate.quantity,
                    stableIds: [...selector.stableIds],
                },
            ];
        });
    return { actions, matchSelectorPredicates, revision };
}

function automationModeTrackIdsOf(actions: readonly ExecutableRuntimeAction[]): string[] {
    return actions.flatMap((action) => (action.type === 'setAutomationMode' ? [action.payload.trackId] : []));
}

function propose(
    id: string,
    actions: ExecutableRuntimeAction[],
    matchSelectorPredicates: SemanticCommandListMatchSelectorRecord[],
    projectRevision: string
): void {
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: id,
        batchId: id,
        projectId: captureProjectIdentity(),
        baseRevision: projectRevision,
        intent: 'color every drum-family track red',
        dynamicEffects: {
            affectedTrackIds: [],
            affectedClipIds: [],
            affectedTargetIds: [],
            automationPoints: 0,
            deletedObjects: 0,
        },
        commands: actions.map((action) =>
            serializeVersionedCommandEnvelope(
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action,
                    expectedEffect: action.type,
                    normalizedProjectRevision: projectRevision,
                    options: { groupId: id, groupLabel: 'Color drum tracks', source: 'prompt' },
                })
            )
        ),
    });
    proposePendingActionConfirmation({
        id,
        prompt: 'color the drums red',
        assistantMessageId: 'assistant-1',
        actions,
        actionLabels: actions.map((action) => action.type),
        commandBatch,
        agentApproval: compileAgentRiskApproval({ commandBatch }),
        executionMode: 'atomic',
        projectRevision,
        matchSelectorPredicates,
    });
}

function trackColorsById(): Map<string, string> {
    return new Map((trackStore.value?.tracks ?? []).map((track) => [track.id, track.color]));
}

/**
 * `propose()` never sets an explicit `runId`, so `proposePendingActionConfirmation` falls back to the
 * fixed `assistantMessageId` ('assistant-1') as the confirmation's run id. `reproposePendingChatActions`
 * only replaces a proposal belonging to a live, non-terminal run, so a repropose-driven test needs one
 * registered under that same id first.
 */
function registerReproposableRun(): void {
    agentRunLifecycle.create({
        runId: 'assistant-1',
        request: 'color the drums red',
        mode: 'apply',
        createdRevision: null,
        createdAt: 1,
    });
    // `recordBatch` (called when a re-preview persists its replacement) requests the
    // 'waiting-for-approval' phase, which only 'planning' may transition into.
    agentRunLifecycle.transitionPhase({ runId: 'assistant-1', phase: 'planning' });
}

describe('match selector approval revalidation', () => {
    beforeEach(() => {
        configureAiWorkflowCommandPreflightFixture();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('match selector approval revalidation test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        setArrangementEventBus({ emit: () => Promise.resolve() });
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        agentRunLifecycle.clear();
        agentProjectRepairStateStore.set(null);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        projectStore.set(defaultProjectStoreState);
        chatStore.set({
            messages: [{ id: 'assistant-1', role: 'assistant', content: 'Awaiting confirmation', timestamp: 1 }],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        });
    });

    afterEach(() => {
        resetAiWorkflowCommandPreflightFixture();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        agentRunLifecycle.clear();
        agentProjectRepairStateStore.set(null);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        projectStore.set(defaultProjectStoreState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('invalidates a predicate-selected color batch when a new track starts matching before confirmation', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
        ]);
        const { actions, matchSelectorPredicates, revision } = compileDrumColorProposal();
        expect(trackIdsOf(actions).toSorted()).toEqual(['track-kick', 'track-snare']);
        propose('confirmation-drum-color-a', actions, matchSelectorPredicates, revision);

        const tracksBeforeTom = trackStore.value?.tracks ?? [];
        setTracks([...tracksBeforeTom, createColorableTrack('track-tom', 'Tom')]);

        const result = await confirmPendingChatActions({ confirmationId: 'confirmation-drum-color-a' });

        expect(result.status).toBe('invalidated');
        expect([...trackColorsById().values()]).toEqual([
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
        ]);
    });

    it('invalidates a predicate-selected color batch when a matched track stops matching before confirmation', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
        ]);
        const { actions, matchSelectorPredicates, revision } = compileDrumColorProposal();
        expect(trackIdsOf(actions).toSorted()).toEqual(['track-kick', 'track-snare']);
        propose('confirmation-drum-color-b', actions, matchSelectorPredicates, revision);

        // An authored production-brief role takes precedence over the name-derived canonical role,
        // moving the snare's role family off 'drums' without touching the snare's own track record —
        // so `classifyAgentProjectDivergence`'s target-fingerprint check (which only inspects the
        // resolved trackIds' own CRDT records) sees no change at all, and only the selector
        // revalidation this fix adds can catch it.
        const currentProjectState = projectStore.value ?? defaultProjectStoreState;
        projectStore.set({
            ...currentProjectState,
            productionBrief: {
                ...currentProjectState.productionBrief,
                trackRoles: [
                    ...currentProjectState.productionBrief.trackRoles,
                    { id: 'authored-role-snare-guitar', trackId: 'track-snare', role: 'guitar', createdAt: Date.now() },
                ],
            },
        });
        flushAutomergeStorageWrites();

        const result = await confirmPendingChatActions({ confirmationId: 'confirmation-drum-color-b' });

        expect(result.status).toBe('invalidated');
        expect([...trackColorsById().values()]).toEqual([
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
        ]);
    });

    it('reapproves then executes a predicate-selected color batch after an unrelated track is added', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
        ]);
        const { actions, matchSelectorPredicates, revision } = compileDrumColorProposal();
        expect(trackIdsOf(actions).toSorted()).toEqual(['track-kick', 'track-snare']);
        propose('confirmation-drum-color-c', actions, matchSelectorPredicates, revision);

        const tracksBeforeKeys = trackStore.value?.tracks ?? [];
        setTracks([...tracksBeforeKeys, createColorableTrack('track-keys', 'Keys')]);

        const first = await confirmPendingChatActions({ confirmationId: 'confirmation-drum-color-c' });
        expect(first.status).toBe('reapproval_required');
        if (first.status === 'reapproval_required') {
            expect(first.divergence.kind).toBe('non-overlapping');
        }
        expect([...trackColorsById().values()]).toEqual([
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
        ]);

        const second = await confirmPendingChatActions({ confirmationId: 'confirmation-drum-color-c' });
        expect(second.status).toBe('executed');
        const colors = trackColorsById();
        expect(colors.get('track-kick')).toBe(DRUM_COLOR);
        expect(colors.get('track-snare')).toBe(DRUM_COLOR);
        expect(colors.get('track-lead-vocal')).toBe(DEFAULT_TRACK_COLOR);
        expect(colors.get('track-keys')).toBe(DEFAULT_TRACK_COLOR);
    });

    it('invalidates a predicate-selected color batch when the resolved set swaps membership without changing size', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
        ]);
        const { actions, matchSelectorPredicates, revision } = compileDrumColorProposal();
        expect(trackIdsOf(actions).toSorted()).toEqual(['track-kick', 'track-snare']);
        propose('confirmation-drum-color-swap', actions, matchSelectorPredicates, revision);

        // Snare leaves the drums family through an authored production-brief role at the same moment
        // Tom joins it, so the live selector still resolves exactly two targets — just not the two
        // the approved batch carried. A revalidation that only compared resolved counts would miss
        // this; only a full id-set comparison catches it.
        const currentProjectState = projectStore.value ?? defaultProjectStoreState;
        projectStore.set({
            ...currentProjectState,
            productionBrief: {
                ...currentProjectState.productionBrief,
                trackRoles: [
                    ...currentProjectState.productionBrief.trackRoles,
                    { id: 'authored-role-snare-guitar', trackId: 'track-snare', role: 'guitar', createdAt: Date.now() },
                ],
            },
        });
        const tracksBeforeTom = trackStore.value?.tracks ?? [];
        setTracks([...tracksBeforeTom, createColorableTrack('track-tom', 'Tom')]);

        const result = await confirmPendingChatActions({ confirmationId: 'confirmation-drum-color-swap' });

        expect(result.status).toBe('invalidated');
        expect([...trackColorsById().values()]).toEqual([
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
        ]);
    });

    it('reapproves rather than invalidates when the matched tracks are reordered without changing membership', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
        ]);
        const { actions, matchSelectorPredicates, revision } = compileDrumColorProposal();
        expect(trackIdsOf(actions)).toEqual(['track-kick', 'track-snare']);
        propose('confirmation-drum-color-reorder', actions, matchSelectorPredicates, revision);

        // Moving snare ahead of kick changes candidate resolution order (it mirrors live track-store
        // order) without adding, removing, or renaming anything, so the resolved id set is identical —
        // just reversed. Only an order-insensitive comparison can tell that apart from a real swap.
        const tracksBeforeReorder = trackStore.value?.tracks ?? [];
        const snare = tracksBeforeReorder.find((track) => track.id === 'track-snare');
        if (!snare) {
            throw new Error('Expected the snare track to exist before reordering it.');
        }
        setTracks([snare, ...tracksBeforeReorder.filter((track) => track.id !== 'track-snare')]);

        const result = await confirmPendingChatActions({ confirmationId: 'confirmation-drum-color-reorder' });

        expect(result.status).toBe('reapproval_required');
        expect([...trackColorsById().values()]).toEqual([
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
        ]);
    });

    it('rejects a re-preview and persists nothing when a new track starts matching before the repreview', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
        ]);
        registerReproposableRun();
        const { actions, matchSelectorPredicates, revision } = compileDrumColorProposal();
        propose('confirmation-repropose-reject', actions, matchSelectorPredicates, revision);

        const tracksBeforeTom = trackStore.value?.tracks ?? [];
        setTracks([...tracksBeforeTom, createColorableTrack('track-tom', 'Tom')]);

        const result = await reproposePendingChatActions({ confirmationId: 'confirmation-repropose-reject' });

        expect(result.status).toBe('rejected');
        const original = getPendingActionConfirmation('confirmation-repropose-reject');
        expect(original?.status).toBe('proposed');
        expect(original?.supersededBy).toBeNull();
        expect([...trackColorsById().values()]).toEqual([
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
        ]);
    });

    it('reproposes and carries the match selector predicates forward when the matched set is unchanged', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
        ]);
        registerReproposableRun();
        const { actions, matchSelectorPredicates, revision } = compileDrumColorProposal();
        propose('confirmation-repropose-unchanged', actions, matchSelectorPredicates, revision);

        const result = await reproposePendingChatActions({ confirmationId: 'confirmation-repropose-unchanged' });

        expect(result.status).toBe('reproposed');
        if (result.status !== 'reproposed') {
            throw new Error('Expected the re-preview to succeed.');
        }
        const reproposed = getPendingActionConfirmation(result.confirmationId);
        expect(reproposed?.approvalSnapshot.matchSelectorPredicates).toEqual(matchSelectorPredicates);

        const outcome = await confirmPendingChatActions({ confirmationId: result.confirmationId });
        expect(outcome.status).toBe('executed');
        const colors = trackColorsById();
        expect(colors.get('track-kick')).toBe(DRUM_COLOR);
        expect(colors.get('track-snare')).toBe(DRUM_COLOR);
        expect(colors.get('track-lead-vocal')).toBe(DEFAULT_TRACK_COLOR);
    });

    it('reapproves rather than invalidates a subset repropose after deleting a target the subset excluded', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
        ]);
        registerReproposableRun();
        const { actions, matchSelectorPredicates, revision } = compileDrumAutomationModeProposal();
        expect(automationModeTrackIdsOf(actions)).toEqual(['track-kick', 'track-snare']);
        propose('confirmation-subset', actions, matchSelectorPredicates, revision);

        const original = getPendingActionConfirmation('confirmation-subset');
        const commandBatch = original?.approvalSnapshot.commandBatch;
        if (!commandBatch) {
            throw new Error('Expected the proposed confirmation to carry a command batch.');
        }
        const parsedOriginal = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        if (parsedOriginal.status === 'invalid') {
            throw new Error(parsedOriginal.reason);
        }
        const kickCommand = parsedOriginal.envelope.commands.find(
            (command) => command.arguments.trackId === 'track-kick'
        );
        if (!kickCommand) {
            throw new Error('Expected a setAutomationMode command targeting the kick track.');
        }

        // Selecting only the kick command drops the carried selector record: the subset no longer
        // covers every id (`track-snare`) the record's `stableIds` named, so the fix must not carry it
        // forward. Deleting the excluded snare track afterward must not invalidate a batch that only
        // ever targets the still-live kick track.
        const repropose = await reproposePendingChatActions({
            confirmationId: 'confirmation-subset',
            selectedIntentGroupIds: [kickCommand.commandId],
        });
        expect(repropose.status).toBe('reproposed');
        if (repropose.status !== 'reproposed') {
            throw new Error('Expected the subset re-preview to succeed.');
        }
        const subsetConfirmation = getPendingActionConfirmation(repropose.confirmationId);
        expect(subsetConfirmation?.approvalSnapshot.matchSelectorPredicates).toBeUndefined();
        expect(automationModeTrackIdsOf(subsetConfirmation?.actions ?? [])).toEqual(['track-kick']);

        setTracks((trackStore.value?.tracks ?? []).filter((track) => track.id !== 'track-snare'));

        const outcome = await confirmPendingChatActions({ confirmationId: repropose.confirmationId });
        expect(outcome.status).toBe('reapproval_required');
    });

    it('reports invalidated without throwing when the project needs repair on a changed revision', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
        ]);
        const { actions, matchSelectorPredicates, revision } = compileDrumColorProposal();
        propose('confirmation-repair-state', actions, matchSelectorPredicates, revision);

        const tracksBeforeKeys = trackStore.value?.tracks ?? [];
        setTracks([...tracksBeforeKeys, createColorableTrack('track-keys', 'Keys')]);
        agentProjectRepairStateStore.set({
            status: 'repair-required',
            detectedRevision: captureProjectRevision(),
            audioGraphValid: false,
            projectInvariantsValid: false,
            inspectionAvailable: true,
            rawProjectRetained: true,
            repairCandidates: [],
        });

        const result = await confirmPendingChatActions({ confirmationId: 'confirmation-repair-state' });

        expect(result.status).toBe('invalidated');
        expect([...trackColorsById().values()]).toEqual([
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
        ]);
    });

    it('rejects a re-preview and persists nothing when the project needs repair on a changed revision', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
        ]);
        registerReproposableRun();
        const { actions, matchSelectorPredicates, revision } = compileDrumColorProposal();
        propose('confirmation-repair-state-repropose', actions, matchSelectorPredicates, revision);

        const tracksBeforeKeys = trackStore.value?.tracks ?? [];
        setTracks([...tracksBeforeKeys, createColorableTrack('track-keys', 'Keys')]);
        agentProjectRepairStateStore.set({
            status: 'repair-required',
            detectedRevision: captureProjectRevision(),
            audioGraphValid: false,
            projectInvariantsValid: false,
            inspectionAvailable: true,
            rawProjectRetained: true,
            repairCandidates: [],
        });

        const result = await reproposePendingChatActions({ confirmationId: 'confirmation-repair-state-repropose' });

        expect(result.status).toBe('rejected');
        const original = getPendingActionConfirmation('confirmation-repair-state-repropose');
        expect(original?.status).toBe('proposed');
        expect([...trackColorsById().values()]).toEqual([
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
        ]);
    });
});
