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

/**
 * Mirrors `parsePromptToActions.ts`'s own derivation: a record's `actionPositions` come from its
 * item's `representativeCommandIndexes`, deduplicated, never from `stableIds` and never from the
 * item's own `commandStart`/`commandCount` range — canonical command deduplication can fully resolve
 * a `match` item's commands onto an earlier item's identical commands, leaving that item's own range
 * empty even though its intent is still carried by those earlier positions. A helper compiling
 * selector evidence by hand must derive positions the same way the real production path does.
 */
function actionPositionsByItemId(
    compiled: ReturnType<typeof compileArbitraryCommandList>
): ReadonlyMap<string, number[]> {
    const items = compiled.status === 'accepted' ? (compiled.compilerEvidence?.items ?? []) : [];
    return new Map(items.map((item) => [item.itemId, [...new Set(item.representativeCommandIndexes)]]));
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
    const positionsByItemId = actionPositionsByItemId(compiled);
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
                    actionPositions: positionsByItemId.get(selector.itemId) ?? [],
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
    const positionsByItemId = actionPositionsByItemId(compiled);
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
                    actionPositions: positionsByItemId.get(selector.itemId) ?? [],
                },
            ];
        });
    return { actions, matchSelectorPredicates, revision };
}

function automationModeTrackIdsOf(actions: readonly ExecutableRuntimeAction[]): string[] {
    return actions.flatMap((action) => (action.type === 'setAutomationMode' ? [action.payload.trackId] : []));
}

/**
 * Two `where`-selected `setAutomationMode` items put Kick and Snare into write mode explicitly; a
 * third, `match`-selected `roleFamily: drums` item asks for the identical mode on the identical two
 * tracks. Every one of that third item's commands is therefore byte-identical to one the first two
 * items already registered, so canonical deduplication adds no new commands for it: its own
 * `commandStart`/`commandCount` range is empty even though its intent is fully carried by the first
 * two items' commands. A fourth, unrelated item (Lead Vocal, a different mode) gives a subset
 * re-preview something to keep or drop independently of the deduplicated record's own positions.
 * `setTrackColor` cannot execute inside an isolated preview (see `buildDrumRoutingAndAutomationCall`
 * above), so this reproduces the dedup scenario with `setAutomationMode` instead of a literal color.
 */
function buildAutomationModeDeduplicationCall() {
    return [
        {
            name: 'command.batch.propose',
            arguments: {
                plan: {
                    semantic: { classification: 'simple' as const, uncertainty: [] },
                    objective:
                        'Put the kick and snare into write mode, the lead vocal into touch mode, then put every drum-family track into write mode.',
                    constraints: ['Do not create, delete, or rename any track.'],
                    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                    capabilityIds: ['setAutomationMode'],
                    assetIds: [],
                    alternatives: [],
                    validationStrategy: [
                        'Set the kick, snare, and lead vocal automation modes directly, then resolve the drum-family selector.',
                    ],
                    stoppingConditions: ['Stop if the selector resolves more than its maximum of 8 tracks.'],
                },
                list: {
                    schemaVersion: 1,
                    items: [
                        {
                            id: 'mode-kick',
                            name: 'setAutomationMode',
                            arguments: { mode: DRUM_AUTOMATION_MODE },
                            selector: {
                                targetArgument: 'trackId',
                                entity: 'track',
                                where: { name: 'Kick' },
                                quantity: { unit: 'targets', exactly: 1 },
                            },
                        },
                        {
                            id: 'mode-snare',
                            name: 'setAutomationMode',
                            arguments: { mode: DRUM_AUTOMATION_MODE },
                            selector: {
                                targetArgument: 'trackId',
                                entity: 'track',
                                where: { name: 'Snare' },
                                quantity: { unit: 'targets', exactly: 1 },
                            },
                        },
                        {
                            id: 'mode-lead-vocal',
                            name: 'setAutomationMode',
                            arguments: { mode: 'touch' },
                            selector: {
                                targetArgument: 'trackId',
                                entity: 'track',
                                where: { name: 'Lead Vocal' },
                                quantity: { unit: 'targets', exactly: 1 },
                            },
                        },
                        {
                            id: 'mode-drums-dedup',
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
 * Compiles the automation-mode dedup batch directly through the compiler, the same way
 * `parsePromptToActions` does, so the `mode-drums-dedup` item's `matchSelectorPredicates` record can
 * be asserted against its `representativeCommandIndexes`-derived positions rather than an empty range.
 */
function compileAutomationModeDeduplicationProposal(): {
    actions: ExecutableRuntimeAction[];
    matchSelectorPredicates: SemanticCommandListMatchSelectorRecord[];
    revision: string;
} {
    const context = getProjectContext();
    const revision = captureProjectRevision();
    const compiled = compileArbitraryCommandList({
        context,
        revision,
        calls: buildAutomationModeDeduplicationCall(),
    });
    if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
        const reason = compiled.status === 'rejected' ? compiled.reason : 'missing compiler evidence';
        throw new Error(`Expected the automation-mode dedup batch to compile: ${reason}`);
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
    const positionsByItemId = actionPositionsByItemId(compiled);
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
                    actionPositions: positionsByItemId.get(selector.itemId) ?? [],
                },
            ];
        });
    return { actions, matchSelectorPredicates, revision };
}

function createMasterTrack(id: string): Track {
    return { ...createColorableTrack(id, 'Master'), kind: 'master' };
}

/**
 * A batch mixing two `where`-selected `setTrackOutput` items with a `match`-selected
 * `setAutomationMode` item, both kinds targeting the same two tracks (Kick, Snare). The `where`
 * items never populate `matchSelectorPredicates` (only a `match` selector does), so this
 * reproduces the defect the fix corrects: a subset that keeps only the `setTrackOutput` commands
 * still leaves their affected ids (`track-kick`, `track-snare`) identical to the automation
 * record's `stableIds`, which is exactly what let the old id-coverage check keep a record whose
 * own item contributed no kept action at all. `setTrackOutput` supports isolated preview and, like
 * `setAutomationMode`, is not forced into a singleton batch, so a subset re-preview of this batch
 * does not reject before reaching the selector-coverage filter under test.
 */
function buildDrumRoutingAndAutomationCall() {
    return [
        {
            name: 'command.batch.propose',
            arguments: {
                plan: {
                    semantic: { classification: 'simple' as const, uncertainty: [] },
                    objective:
                        'Route the kick and snare to master, then put every drum-family track into automation write mode.',
                    constraints: ['Do not create, delete, or rename any track.'],
                    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                    capabilityIds: ['setTrackOutput', 'setAutomationMode'],
                    assetIds: [],
                    alternatives: [],
                    validationStrategy: [
                        'Route the kick and snare tracks by name, then resolve the drum-family selector.',
                    ],
                    stoppingConditions: ['Stop if the selector resolves more than its maximum of 8 tracks.'],
                },
                list: {
                    schemaVersion: 1,
                    items: [
                        {
                            id: 'route-kick',
                            name: 'setTrackOutput',
                            arguments: { outputId: 'track-master' },
                            selector: {
                                targetArgument: 'trackId',
                                entity: 'track',
                                where: { name: 'Kick' },
                                quantity: { unit: 'targets', exactly: 1 },
                            },
                        },
                        {
                            id: 'route-snare',
                            name: 'setTrackOutput',
                            arguments: { outputId: 'track-master' },
                            selector: {
                                targetArgument: 'trackId',
                                entity: 'track',
                                where: { name: 'Snare' },
                                quantity: { unit: 'targets', exactly: 1 },
                            },
                        },
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

function compileDrumRoutingAndAutomationProposal(): {
    actions: ExecutableRuntimeAction[];
    matchSelectorPredicates: SemanticCommandListMatchSelectorRecord[];
    revision: string;
} {
    const context = getProjectContext();
    const revision = captureProjectRevision();
    const compiled = compileArbitraryCommandList({ context, revision, calls: buildDrumRoutingAndAutomationCall() });
    if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
        const reason = compiled.status === 'rejected' ? compiled.reason : 'missing compiler evidence';
        throw new Error(`Expected the drum routing-and-automation batch to compile: ${reason}`);
    }
    const actions: ExecutableRuntimeAction[] = compiled.compilerEvidence.commands.map((command) => {
        if (command.name === 'setTrackOutput') {
            if (typeof command.arguments.trackId !== 'string' || typeof command.arguments.outputId !== 'string') {
                throw new TypeError('Expected a canonical setTrackOutput command.');
            }
            return {
                type: 'setTrackOutput' as const,
                payload: { trackId: command.arguments.trackId, outputId: command.arguments.outputId },
            };
        }
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
    const positionsByItemId = actionPositionsByItemId(compiled);
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
                    actionPositions: positionsByItemId.get(selector.itemId) ?? [],
                },
            ];
        });
    return { actions, matchSelectorPredicates, revision };
}

function trackOutputTrackIdsOf(actions: readonly ExecutableRuntimeAction[]): string[] {
    return actions.flatMap((action) => (action.type === 'setTrackOutput' ? [action.payload.trackId] : []));
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

    it('drops the drum-automation record from an output-only subset re-preview even after a new track starts matching it too', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
            createMasterTrack('track-master'),
        ]);
        registerReproposableRun();
        const { actions, matchSelectorPredicates, revision } = compileDrumRoutingAndAutomationProposal();
        expect(trackOutputTrackIdsOf(actions)).toEqual(['track-kick', 'track-snare']);
        expect(automationModeTrackIdsOf(actions)).toEqual(['track-kick', 'track-snare']);
        propose('confirmation-subset-output-only', actions, matchSelectorPredicates, revision);

        const original = getPendingActionConfirmation('confirmation-subset-output-only');
        const commandBatch = original?.approvalSnapshot.commandBatch;
        if (!commandBatch) {
            throw new Error('Expected the proposed confirmation to carry a command batch.');
        }
        const parsedOriginal = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        if (parsedOriginal.status === 'invalid') {
            throw new Error(parsedOriginal.reason);
        }
        const outputCommandIds = parsedOriginal.envelope.commands
            .filter((command) => command.operation === 'setTrackOutput')
            .map((command) => command.commandId);
        expect(outputCommandIds).toHaveLength(2);

        // A new drum-family track appears before the re-preview: the old id-coverage check would see
        // this subset's setTrackOutput actions still touching track-kick/track-snare — the same ids
        // the automation record resolved — and wrongly keep the record even though none of the
        // record's own setAutomationMode actions survive the subset at all.
        const tracksBeforeTom = trackStore.value?.tracks ?? [];
        setTracks([...tracksBeforeTom, createColorableTrack('track-tom', 'Tom')]);

        const repropose = await reproposePendingChatActions({
            confirmationId: 'confirmation-subset-output-only',
            selectedIntentGroupIds: outputCommandIds,
        });

        expect(repropose.status).toBe('reproposed');
        if (repropose.status !== 'reproposed') {
            throw new Error('Expected the output-only subset re-preview to succeed.');
        }
        const subsetConfirmation = getPendingActionConfirmation(repropose.confirmationId);
        expect(subsetConfirmation?.approvalSnapshot.matchSelectorPredicates).toBeUndefined();
        expect(trackOutputTrackIdsOf(subsetConfirmation?.actions ?? [])).toEqual(['track-kick', 'track-snare']);
    });

    it('carries the drum-automation record forward with rewritten positions when a subset keeps every one of its actions', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
            createMasterTrack('track-master'),
        ]);
        registerReproposableRun();
        const { actions, matchSelectorPredicates, revision } = compileDrumRoutingAndAutomationProposal();
        propose('confirmation-subset-keeps-record', actions, matchSelectorPredicates, revision);

        const original = getPendingActionConfirmation('confirmation-subset-keeps-record');
        const commandBatch = original?.approvalSnapshot.commandBatch;
        if (!commandBatch) {
            throw new Error('Expected the proposed confirmation to carry a command batch.');
        }
        const parsedOriginal = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        if (parsedOriginal.status === 'invalid') {
            throw new Error(parsedOriginal.reason);
        }
        const routeKickCommand = parsedOriginal.envelope.commands.find(
            (command) => command.operation === 'setTrackOutput' && command.arguments.trackId === 'track-kick'
        );
        const automationCommandIds = parsedOriginal.envelope.commands
            .filter((command) => command.operation === 'setAutomationMode')
            .map((command) => command.commandId);
        if (!routeKickCommand) {
            throw new Error('Expected a setTrackOutput command targeting the kick track.');
        }
        expect(automationCommandIds).toHaveLength(2);

        // Keeps one unrelated command (route-kick) alongside both of the record's own actions, so the
        // kept subset is not a contiguous prefix: the record's original positions [2, 3] must be
        // rewritten to their new indexes [1, 2], not carried forward unchanged.
        const repropose = await reproposePendingChatActions({
            confirmationId: 'confirmation-subset-keeps-record',
            selectedIntentGroupIds: [routeKickCommand.commandId, ...automationCommandIds],
        });

        expect(repropose.status).toBe('reproposed');
        if (repropose.status !== 'reproposed') {
            throw new Error('Expected the subset re-preview to succeed.');
        }
        const subsetConfirmation = getPendingActionConfirmation(repropose.confirmationId);
        expect(trackOutputTrackIdsOf(subsetConfirmation?.actions ?? [])).toEqual(['track-kick']);
        expect(automationModeTrackIdsOf(subsetConfirmation?.actions ?? [])).toEqual(['track-kick', 'track-snare']);
        expect(subsetConfirmation?.approvalSnapshot.matchSelectorPredicates).toEqual([
            {
                itemId: 'automation-drums',
                entity: 'track',
                match: { all: [{ roleFamily: 'drums' }] },
                quantity: { unit: 'targets', maximum: 8 },
                stableIds: ['track-kick', 'track-snare'],
                actionPositions: [1, 2],
            },
        ]);

        const tracksBeforeTom = trackStore.value?.tracks ?? [];
        setTracks([...tracksBeforeTom, createColorableTrack('track-tom', 'Tom')]);

        const outcome = await confirmPendingChatActions({ confirmationId: repropose.confirmationId });
        expect(outcome.status).toBe('invalidated');
    });

    it("carries the deduplicated drum-mode record forward with its earlier items' positions instead of an empty range", async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
        ]);
        registerReproposableRun();
        const { actions, matchSelectorPredicates, revision } = compileAutomationModeDeduplicationProposal();

        // The dedup item contributes no command of its own: every one of its resolved targets
        // (kick, snare) already carries an identical `setAutomationMode` write from the two explicit
        // items ahead of it, so only three actions exist in total.
        expect(automationModeTrackIdsOf(actions)).toEqual(['track-kick', 'track-snare', 'track-lead-vocal']);
        expect(matchSelectorPredicates).toEqual([
            {
                itemId: 'mode-drums-dedup',
                entity: 'track',
                match: { all: [{ roleFamily: 'drums' }] },
                quantity: { unit: 'targets', maximum: 8 },
                stableIds: ['track-kick', 'track-snare'],
                actionPositions: [0, 1],
            },
        ]);
        propose('confirmation-dedup-carries', actions, matchSelectorPredicates, revision);

        const original = getPendingActionConfirmation('confirmation-dedup-carries');
        const commandBatch = original?.approvalSnapshot.commandBatch;
        if (!commandBatch) {
            throw new Error('Expected the proposed confirmation to carry a command batch.');
        }
        const parsedOriginal = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        if (parsedOriginal.status === 'invalid') {
            throw new Error(parsedOriginal.reason);
        }
        const kickCommand = parsedOriginal.envelope.commands.find(
            (command) => command.operation === 'setAutomationMode' && command.arguments.trackId === 'track-kick'
        );
        const snareCommand = parsedOriginal.envelope.commands.find(
            (command) => command.operation === 'setAutomationMode' && command.arguments.trackId === 'track-snare'
        );
        if (!kickCommand || !snareCommand) {
            throw new Error('Expected setAutomationMode commands for both the kick and snare tracks.');
        }

        const repropose = await reproposePendingChatActions({
            confirmationId: 'confirmation-dedup-carries',
            selectedIntentGroupIds: [kickCommand.commandId, snareCommand.commandId],
        });

        expect(repropose.status).toBe('reproposed');
        if (repropose.status !== 'reproposed') {
            throw new Error('Expected the kick-and-snare subset re-preview to succeed.');
        }
        const subsetConfirmation = getPendingActionConfirmation(repropose.confirmationId);
        expect(automationModeTrackIdsOf(subsetConfirmation?.actions ?? [])).toEqual(['track-kick', 'track-snare']);
        expect(subsetConfirmation?.approvalSnapshot.matchSelectorPredicates).toEqual([
            {
                itemId: 'mode-drums-dedup',
                entity: 'track',
                match: { all: [{ roleFamily: 'drums' }] },
                quantity: { unit: 'targets', maximum: 8 },
                stableIds: ['track-kick', 'track-snare'],
                actionPositions: [0, 1],
            },
        ]);
    });

    it('drops the deduplicated drum-mode record from a subset that excludes both of its carrying positions', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
        ]);
        registerReproposableRun();
        const { actions, matchSelectorPredicates, revision } = compileAutomationModeDeduplicationProposal();
        propose('confirmation-dedup-drops', actions, matchSelectorPredicates, revision);

        const original = getPendingActionConfirmation('confirmation-dedup-drops');
        const commandBatch = original?.approvalSnapshot.commandBatch;
        if (!commandBatch) {
            throw new Error('Expected the proposed confirmation to carry a command batch.');
        }
        const parsedOriginal = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        if (parsedOriginal.status === 'invalid') {
            throw new Error(parsedOriginal.reason);
        }
        const leadVocalCommand = parsedOriginal.envelope.commands.find(
            (command) => command.operation === 'setAutomationMode' && command.arguments.trackId === 'track-lead-vocal'
        );
        if (!leadVocalCommand) {
            throw new Error('Expected a setAutomationMode command targeting the lead vocal track.');
        }

        // Keeps only the unrelated lead-vocal command: neither of the dedup record's own carrying
        // positions (the kick and snare commands) survives the subset.
        const repropose = await reproposePendingChatActions({
            confirmationId: 'confirmation-dedup-drops',
            selectedIntentGroupIds: [leadVocalCommand.commandId],
        });

        expect(repropose.status).toBe('reproposed');
        if (repropose.status !== 'reproposed') {
            throw new Error('Expected the lead-vocal-only subset re-preview to succeed.');
        }
        const subsetConfirmation = getPendingActionConfirmation(repropose.confirmationId);
        expect(subsetConfirmation?.approvalSnapshot.matchSelectorPredicates).toBeUndefined();
        expect(automationModeTrackIdsOf(subsetConfirmation?.actions ?? [])).toEqual(['track-lead-vocal']);
    });

    it('rejects a subset re-preview that keeps the drum-automation item once a new track already matches it', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
            createMasterTrack('track-master'),
        ]);
        registerReproposableRun();
        const { actions, matchSelectorPredicates, revision } = compileDrumRoutingAndAutomationProposal();
        propose('confirmation-subset-invalid-before-repropose', actions, matchSelectorPredicates, revision);

        const original = getPendingActionConfirmation('confirmation-subset-invalid-before-repropose');
        const commandBatch = original?.approvalSnapshot.commandBatch;
        if (!commandBatch) {
            throw new Error('Expected the proposed confirmation to carry a command batch.');
        }
        const parsedOriginal = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        if (parsedOriginal.status === 'invalid') {
            throw new Error(parsedOriginal.reason);
        }
        const automationCommandIds = parsedOriginal.envelope.commands
            .filter((command) => command.operation === 'setAutomationMode')
            .map((command) => command.commandId);
        expect(automationCommandIds).toHaveLength(2);

        // Tom joins the drums family before the re-preview itself, so `resolveCarriedSelection` must
        // reject the subset before persisting anything derived from the now-stale selector.
        const tracksBeforeTom = trackStore.value?.tracks ?? [];
        setTracks([...tracksBeforeTom, createColorableTrack('track-tom', 'Tom')]);

        const repropose = await reproposePendingChatActions({
            confirmationId: 'confirmation-subset-invalid-before-repropose',
            selectedIntentGroupIds: automationCommandIds,
        });

        expect(repropose.status).toBe('rejected');
        const stillPending = getPendingActionConfirmation('confirmation-subset-invalid-before-repropose');
        expect(stillPending?.status).toBe('proposed');
        expect(stillPending?.supersededBy).toBeNull();
    });

    it('reapproves a selector-free batch after a revision change even while the project needs repair', async () => {
        setTracks([createColorableTrack('track-kick', 'Kick')]);
        const revision = captureProjectRevision();
        const action: ExecutableRuntimeAction = {
            type: 'setTrackColor',
            payload: { trackId: 'track-kick', color: DRUM_COLOR },
        };
        propose('confirmation-no-selector-repair-state', [action], [], revision);

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

        const result = await confirmPendingChatActions({ confirmationId: 'confirmation-no-selector-repair-state' });

        expect(result.status).toBe('reapproval_required');
        expect(trackColorsById().get('track-kick')).toBe(DEFAULT_TRACK_COLOR);
    });

    it('rebinds a drums record through refreshPendingActionConfirmationApproval on an unrelated change, then invalidates it once a new track matches', async () => {
        setTracks([
            createColorableTrack('track-kick', 'Kick'),
            createColorableTrack('track-snare', 'Snare'),
            createColorableTrack('track-lead-vocal', 'Lead Vocal'),
        ]);
        const { actions, matchSelectorPredicates, revision } = compileDrumColorProposal();
        propose('confirmation-drum-color-rebind-then-invalidate', actions, matchSelectorPredicates, revision);

        const tracksBeforeKeys = trackStore.value?.tracks ?? [];
        setTracks([...tracksBeforeKeys, createColorableTrack('track-keys', 'Keys')]);

        const first = await confirmPendingChatActions({
            confirmationId: 'confirmation-drum-color-rebind-then-invalidate',
        });
        expect(first.status).toBe('reapproval_required');

        const rebound = getPendingActionConfirmation('confirmation-drum-color-rebind-then-invalidate');
        expect(rebound?.approvalSnapshot.matchSelectorPredicates).toEqual(matchSelectorPredicates);

        const tracksBeforeTom = trackStore.value?.tracks ?? [];
        setTracks([...tracksBeforeTom, createColorableTrack('track-tom', 'Tom')]);

        const second = await confirmPendingChatActions({
            confirmationId: 'confirmation-drum-color-rebind-then-invalidate',
        });
        expect(second.status).toBe('invalidated');
        expect([...trackColorsById().values()]).toEqual([
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
            DEFAULT_TRACK_COLOR,
        ]);
    });
});
