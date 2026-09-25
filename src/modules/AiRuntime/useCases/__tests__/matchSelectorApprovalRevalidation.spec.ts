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
    resetActionReplayAuthority,
    serializeVersionedCommandEnvelope,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
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
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getProjectContext } from '../getProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';

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
        const currentProjectState = projectStore.value;
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
        const currentProjectState = projectStore.value;
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
});
