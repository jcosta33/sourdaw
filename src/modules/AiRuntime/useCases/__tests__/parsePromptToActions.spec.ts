import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { AiRuntimeConfigurationChangedError } from '../../errors/AiRuntimeConfigurationChangedError';
import { type AgentRunProviderProposal } from '../../models/AgentRun';
import { type ProjectContext } from '../../models/ProjectContext';
import { type StemImportPromptScope } from '../../models/StemImportCapability';
import {
    buildPresetContext,
    tryPresetMatch,
    tryParameterizedPath,
    tryCompoundFastPath,
} from '../../transformers/promptParser/parsing';
import { getExplicitClipProtection } from '../agentReference/getExplicitlyProtectedClips';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { describePendingActionConfirmation } from '../describePendingActionConfirmation';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome as generateToolCalls } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';

import { advertisedAnswerSchema } from './answerWireFixture';
import {
    readCreativeInterpretationCatalog,
    selectCreativeInterpretationCall,
    type ScriptedTurn,
} from './highLevelIntentWorkflowFixture';
import {
    literalMetricIntakeTurn,
    nonAcousticMetricIntakeTurn,
    readMetricPublication,
} from './metricGoalWorkflowFixture';

const {
    mockLogger,
    mockBridgeGroundedLlmToolCalls,
    mockBuildLlmActionSystemPrompt,
    mockDoesProductionBriefAllowActionBatch,
    markerStoreValue,
} = vi.hoisted(() => ({
    mockLogger: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
    mockBridgeGroundedLlmToolCalls: vi.fn(),
    mockBuildLlmActionSystemPrompt: vi.fn(() => 'command system prompt'),
    mockDoesProductionBriefAllowActionBatch: vi.fn(() => true),
    markerStoreValue: {
        value: {
            markers: [] as { id: string; beat: number; color: string; name: string }[],
            sections: [] as { id: string; startBeat: number; endBeat: number; name: string }[],
        },
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mockLogger,
}));

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    doesProductionBriefAllowActionBatch: mockDoesProductionBriefAllowActionBatch,
}));

vi.mock('#/modules/Arrangement/stores', async () => {
    const actual = await vi.importActual<typeof import('#/modules/Arrangement/stores')>('#/modules/Arrangement/stores');
    return {
        ...actual,
        markerStore: {
            get value() {
                return markerStoreValue.value;
            },
        },
    };
});

vi.mock('../../transformers/promptParser/parsing', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../transformers/promptParser/parsing')>();
    return {
        ...original,
        tryPresetMatch: vi.fn(original.tryPresetMatch),
        buildPresetContext: vi.fn(original.buildPresetContext),
        tryParameterizedPath: vi.fn(original.tryParameterizedPath),
        tryCompoundFastPath: vi.fn(original.tryCompoundFastPath),
    };
});

vi.mock('../getProjectContext', async (importOriginal) => {
    const original = await importOriginal<typeof import('../getProjectContext')>();
    return {
        ...original,
        getProjectContext: vi.fn(original.getProjectContext),
    };
});

vi.mock('../llmOrchestration/inference', async (importOriginal) => {
    const original = await importOriginal<typeof import('../llmOrchestration/inference')>();
    return {
        ...original,
        generateToolPlanningOutcome: vi.fn(original.generateToolPlanningOutcome),
    };
});

vi.mock('../agentReference/bridgeGroundedLlmToolCalls', async (importOriginal) => {
    const original = await importOriginal<typeof import('../agentReference/bridgeGroundedLlmToolCalls')>();
    return {
        ...original,
        bridgeGroundedLlmToolCalls: mockBridgeGroundedLlmToolCalls,
    };
});

vi.mock('../../transformers/llmActionBridge', async () => {
    const actual = await vi.importActual<typeof import('../../transformers/llmActionBridge')>(
        '../../transformers/llmActionBridge'
    );
    return {
        ...actual,
        buildLlmActionSystemPrompt: mockBuildLlmActionSystemPrompt,
    };
});

// 26 tests below run the real bridge. Transforming its module graph takes several seconds, and
// awaiting it inside a test billed all of that to whichever test ran first — a 5000 ms budget that
// only fit by accident of import order. Resolve it once here, at module scope, where no test
// timeout applies. A static import cannot do this: `vi.mock` owns this specifier, so it would
// resolve to the mock and never transform the real graph.
const actualBridge = await vi.importActual<typeof import('../agentReference/bridgeGroundedLlmToolCalls')>(
    '../agentReference/bridgeGroundedLlmToolCalls'
);
const actualParsing = await vi.importActual<typeof import('../../transformers/promptParser/parsing')>(
    '../../transformers/promptParser/parsing'
);

const baseContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

function createMixerContext(): ProjectContext {
    return {
        ...baseContext,
        tracks: [
            { id: 'track-vocals', name: 'Vocals' },
            { id: 'track-guitar', name: 'Guitar' },
        ].map(({ id, name }) => ({
            id,
            name,
            kind: 'audio',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read',
            outputId: 'master',
            clipCount: 0,
            deviceCount: 0,
            clips: [],
            devices: [],
            sends: [],
        })),
    };
}

function createBulkInsertionContext(): ProjectContext {
    const createTrack = (id: string, name: string, frozen = false) => ({
        id,
        name,
        kind: 'audio' as const,
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read' as const,
        outputId: 'master',
        frozen,
        clipCount: 0,
        deviceCount: 1,
        clips: [],
        devices: [{ id: `${id}-eq`, name: 'EQ', type: 'builtin-eq', bypassed: false }],
        sends: [],
    });
    return {
        ...baseContext,
        availableDeviceTypes: [{ id: 'builtin-compressor', name: 'Compressor' }],
        tracks: [
            createTrack('track-bass-di', 'Bass DI'),
            createTrack('track-bass-amp', 'Bass Amp'),
            createTrack('track-bass-frozen', 'Bass Frozen', true),
            createTrack('track-guitar', 'Guitar'),
        ],
    };
}

function createDrumRoutingContext(): ProjectContext {
    // `role` is what the context producer derives from the name; the workflow scopes read it, not the name.
    const createTrack = (id: string, name: string, kind: 'audio' | 'bus', role: string) => ({
        id,
        name,
        kind,
        canonicalRole: { role, source: 'name-tags', evidence: 'name-tokens' },
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read' as const,
        outputId: 'master',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
    });
    return {
        ...baseContext,
        tracks: [
            createTrack('track-kick', 'Kick', 'audio', 'kick'),
            createTrack('track-snare', 'Snare', 'audio', 'snare'),
            createTrack('track-hats', 'Hats', 'audio', 'hi-hat'),
            createTrack('track-room', 'Drum Room', 'audio', 'room'),
            createTrack('track-parallel', 'Parallel Compression Return', 'audio', 'unknown'),
            createTrack('track-bass', 'Bass DI', 'audio', 'bass'),
            createTrack('bus-drums', 'Drum Bus', 'bus', 'bus'),
        ],
    };
}

type CompletePlanOutcome = {
    status: 'complete';
    toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
};

function scriptedPlan(
    intake: ScriptedTurn,
    planningTurns: readonly CompletePlanOutcome[],
    afterIntake = false
): CompletePlanOutcome {
    let providerTurn = afterIntake ? 1 : 0;
    return {
        then(resolve: (outcome: CompletePlanOutcome) => unknown) {
            const call = vi.mocked(generateToolCalls).mock.calls.at(-1);
            if (call === undefined) {
                throw new Error('Expected the provider invocation that requested this scripted turn.');
            }
            const [, userMessage, schemas] = call;
            const phaseCount = planningTurns.length + 1;
            const phase = providerTurn % phaseCount;
            providerTurn += 1;
            if (phase === 0) {
                return Promise.resolve(resolve({ status: 'complete', toolCalls: intake(userMessage, schemas) }));
            }
            const outcome = planningTurns[phase - 1];
            if (outcome === undefined) {
                throw new Error('Expected a configured provider planning turn.');
            }
            return Promise.resolve(resolve(outcome));
        },
    } as unknown as CompletePlanOutcome;
}

function unsupportedPerceptualIntake(input: {
    targetObjectIds: readonly string[];
    dimensions: readonly string[];
}): ScriptedTurn {
    return (userMessage, providerView) => {
        const catalog = readCreativeInterpretationCatalog(userMessage, providerView);
        const selection = selectCreativeInterpretationCall({
            catalog,
            modeId: 'edit',
            targetObjectIds: input.targetObjectIds,
            dimensions: input.dimensions,
        });
        const published = advertisedAnswerSchema(providerView);
        const unsupported = readMetricPublication({
            function: { description: published.description, parameters: published.parameters },
        }).find((objective) => objective.kind === 'unsupported');
        if (unsupported === undefined) {
            throw new Error('Expected the actual published unsupported metric objective.');
        }
        return [
            {
                ...selection,
                arguments: {
                    ...selection.arguments,
                    answer: null,
                    metricIntent: {
                        kind: 'perceptual',
                        uncertainty: 'none',
                        objectives: [
                            {
                                objectiveId: unsupported.id,
                                scopeCandidateId: null,
                                referenceScopeCandidateId: null,
                                rangeCandidateId: null,
                            },
                        ],
                    },
                },
            },
        ];
    };
}

function completePlan<TToolCall extends { name: string; arguments: Record<string, unknown> }>(
    toolCalls: TToolCall[],
    intake: ScriptedTurn | undefined,
    afterIntake = false
): CompletePlanOutcome {
    const workflowCalls = toolCalls.filter((call) => call.name === 'selectWorkflowCapability');
    const commandCalls = toolCalls.filter((call) => call.name !== 'selectWorkflowCapability');
    const commandNames = [...new Set(commandCalls.map((call) => call.name))];
    const catalogPlan: CompletePlanOutcome = {
        status: 'complete',
        toolCalls: [
            {
                name: 'agent.catalog.discover',
                arguments: { category: 'command', names: commandNames },
            },
        ],
    };
    const proposalPlan: CompletePlanOutcome = {
        status: 'complete',
        toolCalls: [
            ...workflowCalls,
            {
                name: 'command.batch.propose',
                arguments: {
                    commands: commandCalls,
                    plan: {
                        semantic: { classification: 'simple', uncertainty: [] },
                        objective: 'Execute the grounded command batch.',
                        constraints: [],
                        scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                        capabilityIds: commandNames,
                        assetIds: [],
                        alternatives: [],
                        validationStrategy: ['Validate the grounded command batch.'],
                        stoppingConditions: ['Stop if application validation fails.'],
                    },
                },
            },
        ],
    };
    const noActionPlan: CompletePlanOutcome = { status: 'complete', toolCalls: [] };
    if (intake === undefined) {
        return {
            then() {
                throw new Error('Expected this provider plan to be unreachable without an intake script.');
            },
        } as unknown as CompletePlanOutcome;
    }
    // Every request attempt admits the whole request before discovery and proposal.
    let planningTurns = [noActionPlan];
    if (commandCalls.length > 0) {
        planningTurns = [catalogPlan, proposalPlan];
    } else if (workflowCalls.length > 0) {
        planningTurns = [proposalPlan];
    }
    return scriptedPlan(intake, planningTurns, afterIntake);
}

function createGlueProviderContext(): ProjectContext {
    const clips = [
        { id: 'clip-intro', name: 'Intro', startBeat: 0, endBeat: 8 },
        { id: 'clip-verse', name: 'Verse', startBeat: 8, endBeat: 16 },
        { id: 'clip-outro', name: 'Outro', startBeat: 16, endBeat: 24 },
    ].map((clip) => ({
        ...clip,
        type: 'midi' as const,
        gain: 1,
        locked: false,
        muted: false,
        loopEnabled: false,
        noteCount: 4,
    }));
    return {
        ...baseContext,
        glueEligibleClipPairs: [
            ['clip-intro', 'clip-verse'],
            ['clip-verse', 'clip-outro'],
        ],
        tracks: [
            {
                id: 'track-midi',
                name: 'Keys',
                kind: 'midi',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                gain: 0.8,
                pan: 0,
                automationMode: 'read',
                outputId: 'master',
                clipCount: clips.length,
                deviceCount: 0,
                clips,
                devices: [],
                sends: [],
            },
        ],
        selectedTrackId: 'track-midi',
        selectedClipId: 'clip-intro',
        selectedClipIds: ['clip-intro', 'clip-verse'],
    };
}

const stemImportPromptScope = {
    capability: {
        schemaVersion: 1,
        baseRevision: 'revision-stem-import',
        actionType: 'importStemSet',
        selectionId: 'selection-stems',
        projectTempo: 120,
        stems: [
            { stemId: 'stem-kick', sourceName: 'Kick.wav', durationSeconds: 126, detectedTempo: 120 },
            { stemId: 'stem-bass', sourceName: 'Bass.wav', durationSeconds: 126, detectedTempo: 120 },
        ],
        allowedRoles: ['kick', 'bass'],
        constraints: {
            requireCompleteSelection: true,
            preserveExistingProject: true,
            requireFreshConfirmation: true,
            providerCannotAssignProjectIds: true,
        },
    },
    actionSeed: {
        selectionId: 'selection-stems',
        groupName: 'Imported Stems',
        projectTempo: 120,
        folderId: 'folder-imported-stems',
        stems: [
            {
                stemId: 'stem-kick',
                sourceName: 'Kick.wav',
                role: 'other',
                sourceTempo: 120,
                durationSeconds: 126,
                sourceBytes: 1024,
                decodedBytes: 4096,
                audioBufferId: 'buffer-kick',
                trackId: 'track-kick',
                trackName: 'Kick',
                trackGain: 1,
                trackPan: 0,
                clipId: 'clip-kick',
            },
            {
                stemId: 'stem-bass',
                sourceName: 'Bass.wav',
                role: 'other',
                sourceTempo: 120,
                durationSeconds: 126,
                sourceBytes: 2048,
                decodedBytes: 8192,
                audioBufferId: 'buffer-bass',
                trackId: 'track-bass',
                trackName: 'Bass',
                trackGain: 1,
                trackPan: 0,
                clipId: 'clip-bass',
            },
        ],
    },
} satisfies StemImportPromptScope;

describe('parsePromptToActions', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        vi.clearAllMocks();
        vi.mocked(tryPresetMatch).mockReturnValue([]);
        vi.mocked(tryParameterizedPath).mockReturnValue([]);
        vi.mocked(tryCompoundFastPath).mockReturnValue(null);
        vi.mocked(getProjectContext).mockReturnValue(baseContext);
        vi.mocked(generateToolCalls).mockReset();
        mockBridgeGroundedLlmToolCalls.mockReset();
        mockBuildLlmActionSystemPrompt.mockClear();
        mockDoesProductionBriefAllowActionBatch.mockReturnValue(true);
        markerStoreValue.value = { markers: [], sections: [] };
    });

    afterEach(() => {
        clearHandlerRegistry();
        vi.restoreAllMocks();
    });

    it.each(['view-mix', 'open-mixer'])('admits the selected %s ID despite its shared label', async (id) => {
        const result = await parsePromptToActions({
            prompt: 'Open Mixer Panel',
            context: baseContext,
            preset: { id, expectedContext: buildPresetContext(baseContext) },
        });
        expect(result.actions).toHaveLength(1);
        expect(result.metricGoalState).toContain('complete-literal-parser');
        expect(generateToolCalls).not.toHaveBeenCalled();
    });

    it('preserves free-text ambiguity and selects clipboard copy by its ID', async () => {
        const context = createMixerContext();
        context.selectedTrackId = 'track-vocals';
        context.selectedClipId = 'clip-vocal';
        context.tracks[0]!.clips = [
            { id: 'clip-vocal', name: 'Vocal', type: 'audio', startBeat: 0, endBeat: 4, noteCount: 0 },
        ];
        vi.mocked(tryPresetMatch).mockImplementation(actualParsing.tryPresetMatch);
        for (const prompt of ['Open Mixer Panel', 'copy clip']) {
            const result = await parsePromptToActions({ prompt, context, providerPlanning: 'disabled' });
            expect(result.actions).toEqual([]);
            expect(result.metricGoalState).toBeUndefined();
        }
        const copied = await parsePromptToActions({
            prompt: 'Copy Clip',
            context,
            preset: { id: 'copy-clip', expectedContext: buildPresetContext(context) },
        });
        expect(copied.actions).toEqual([{ type: 'copyClip' }]);
        expect(generateToolCalls).not.toHaveBeenCalled();
    });

    it.each([
        ['unknown ID', 'missing', 'Play', 'none'],
        ['wrong label', 'play', 'Delete Track', 'none'],
        ['extended label', 'add-eq', 'Add EQ and make Vocal warmer', 'track'],
        ['missing track', 'add-eq', 'Add EQ', 'none'],
        ['stale track', 'add-eq', 'Add EQ', 'stale-track'],
        ['changed track kind', 'add-eq', 'Add EQ', 'track-kind'],
        ['changed clip type', 'copy-clip', 'Copy Clip', 'clip-type'],
        ['unavailable MIDI clip', 'quantize', 'Quantize Notes', 'audio-clip'],
        ['null builder', 'add-auto-lane', 'Add Automation Lane', 'track'],
        ['readonly', 'play', 'Play', 'readonly'],
    ])('refuses a selected preset with %s without provider fallback', async (_case, id, prompt, variation) => {
        const context = createMixerContext();
        if (variation !== 'none') {
            context.selectedTrackId = 'track-vocals';
        }
        if (variation === 'clip-type' || variation === 'audio-clip') {
            context.selectedClipId = 'clip-vocal';
            context.tracks[0]!.clips = [
                { id: 'clip-vocal', name: 'Vocal', type: 'audio', startBeat: 0, endBeat: 4, noteCount: 0 },
            ];
        }
        const expectedContext = buildPresetContext(context);
        if (variation === 'stale-track') {
            expectedContext.selectedTrackId = 'track-guitar';
        }
        if (variation === 'track-kind') {
            expectedContext.selectedTrackKind = 'midi';
        }
        if (variation === 'clip-type') {
            expectedContext.selectedClipType = 'midi';
        }
        const options: Parameters<typeof parsePromptToActions>[0] = {
            prompt: prompt!,
            context,
            preset: { id: id!, expectedContext },
        };
        if (variation === 'readonly') {
            options.profile = 'readonly-answer';
        }
        const result = await parsePromptToActions(options);
        expect(result.actions).toEqual([]);
        expect(result.metricGoalState).toBeUndefined();
        expect(result.planningOutcome.kind).toBe('denied');
        expect(generateToolCalls).not.toHaveBeenCalled();
        expect(tryPresetMatch).not.toHaveBeenCalled();
        expect(tryParameterizedPath).not.toHaveBeenCalled();
        expect(tryCompoundFastPath).not.toHaveBeenCalled();
    });

    it.each([
        {
            prompt: 'set tempo to 128',
            action: { type: 'setTempo' as const, payload: { bpm: 128 } },
            producer: 'parameterized' as const,
        },
        {
            prompt: 'remove all tracks',
            action: { type: 'removeAllTracks' as const },
            producer: 'preset' as const,
        },
    ])('applies app-owned confirmation policy to a single $producer action', async ({ prompt, action, producer }) => {
        if (producer === 'parameterized') {
            vi.mocked(tryParameterizedPath).mockReturnValue([action]);
        } else {
            vi.mocked(tryPresetMatch).mockReturnValue([action]);
        }

        const result = await parsePromptToActions({ prompt, context: baseContext });

        expect(result.actions).toEqual([action]);
        expect(result.requiresConfirmation).toBe(true);
    });

    it('requires confirmation for a multi-action compound fast path', async () => {
        const actions = [
            { type: 'muteTrack' as const, payload: { trackId: 'track-vocals', muted: true } },
            { type: 'setTrackGain' as const, payload: { trackId: 'track-guitar', gain: 0.6 } },
        ];
        vi.mocked(tryCompoundFastPath).mockReturnValue(actions);

        const result = await parsePromptToActions({
            prompt: 'mute vocals and lower guitar',
            context: createMixerContext(),
        });

        expect(result.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true, expectedMuted: false } },
            {
                type: 'setTrackGain',
                payload: {
                    trackId: 'track-guitar',
                    gain: 0.6,
                    expectedGain: 0.8,
                    automationRecordingPolicy: 'suppressed',
                },
            },
        ]);
        expect(result.requiresConfirmation).toBe(true);
    });

    it('preserves user text case when renaming a clip through deterministic parameterized path', async () => {
        vi.mocked(tryParameterizedPath).mockImplementation(actualParsing.tryParameterizedPath);

        const mixerContext = createMixerContext();
        const track = mixerContext.tracks[0]!;
        const context: ProjectContext = {
            ...mixerContext,
            tracks: [
                {
                    ...track,
                    clipCount: 1,
                    clips: [
                        {
                            id: 'c1',
                            name: 'Intro',
                            type: 'audio',
                            startBeat: 0,
                            endBeat: 8,
                            noteCount: 0,
                        },
                    ],
                },
                ...mixerContext.tracks.slice(1),
            ],
            selectedClipId: 'c1',
            selectedClipIds: ['c1'],
        };
        vi.mocked(getProjectContext).mockReturnValue(context);

        const result = await parsePromptToActions({ prompt: 'rename clip to Verse', context });

        expect(result.actions).toEqual([
            {
                type: 'renameClip',
                payload: { clipId: 'c1', name: 'Verse' },
            },
        ]);
        expect(generateToolCalls).not.toHaveBeenCalled();

        const upperResult = await parsePromptToActions({ prompt: 'RENAME THE CLIP TO "Chorus 1"', context });

        expect(upperResult.actions).toEqual([
            {
                type: 'renameClip',
                payload: { clipId: 'c1', name: 'Chorus 1' },
            },
        ]);
        expect(generateToolCalls).not.toHaveBeenCalled();
    });

    it('preserves 1% gain semantics for track volume command on fast path', async () => {
        vi.mocked(tryParameterizedPath).mockImplementation(actualParsing.tryParameterizedPath);

        const context: ProjectContext = {
            ...createMixerContext(),
            selectedTrackId: 'track-vocals',
        };
        vi.mocked(getProjectContext).mockReturnValue(context);

        const percentResult = await parsePromptToActions({ prompt: 'volume 1%', context });

        expect(percentResult.actions).toHaveLength(1);
        expect(percentResult.actions[0]?.payload).toMatchObject({
            trackId: 'track-vocals',
            gain: 0.01,
        });
        expect(generateToolCalls).not.toHaveBeenCalled();

        const bareResult = await parsePromptToActions({ prompt: 'set volume to 1', context });

        expect(bareResult.actions).toHaveLength(1);
        expect(bareResult.actions[0]?.payload).toMatchObject({
            trackId: 'track-vocals',
            gain: 1,
        });
        expect(generateToolCalls).not.toHaveBeenCalled();
    });

    it('preserves user text case for track names when creating multiple tracks through compound fast path', async () => {
        vi.mocked(tryCompoundFastPath).mockImplementation(actualParsing.tryCompoundFastPath);

        const result = await parsePromptToActions({
            prompt: 'create 2 audio tracks named "Lead Vocals", "Backing Vocals"',
            context: baseContext,
        });

        expect(result.actions).toEqual([
            {
                type: 'addTrack',
                payload: { name: 'Lead Vocals', kind: 'audio' },
            },
            {
                type: 'addTrack',
                payload: { name: 'Backing Vocals', kind: 'audio' },
            },
        ]);
        expect(generateToolCalls).not.toHaveBeenCalled();

        const upperResult = await parsePromptToActions({
            prompt: 'CREATE 2 AUDIO TRACKS NAMED "Lead Vocals", "Backing Vocals"',
            context: baseContext,
        });
        expect(upperResult.actions).toEqual([
            {
                type: 'addTrack',
                payload: { name: 'Lead Vocals', kind: 'audio' },
            },
            {
                type: 'addTrack',
                payload: { name: 'Backing Vocals', kind: 'audio' },
            },
        ]);
        expect(generateToolCalls).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'executes one generic semantic bulk selector without per-target prompt grounding',
            prompt: 'mute all audio tracks',
            arguments_: { muted: true },
            expectedActions: [
                { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true, expectedMuted: false } },
                { type: 'muteTrack', payload: { trackId: 'track-guitar', muted: true, expectedMuted: false } },
            ],
        },
        {
            name: 'rejects a negated operation despite compiler-resolved target IDs',
            prompt: 'do not mute any audio tracks',
            arguments_: { muted: true },
            expectedActions: [],
        },
        {
            name: 'rejects a non-requested parameter despite compiler-resolved target IDs',
            prompt: 'mute all audio tracks',
            arguments_: { muted: false },
            expectedActions: [],
        },
    ])('$name', async ({ prompt, arguments_, expectedActions }) => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            scriptedPlan(literalMetricIntakeTurn, [
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'catalog-mute-track',
                            name: 'agent.catalog.discover',
                            arguments: { category: 'command', names: ['muteTrack'] },
                        },
                    ],
                },
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'semantic-mute-tracks',
                            name: 'command.batch.propose',
                            arguments: {
                                plan: {
                                    semantic: { classification: 'simple', uncertainty: [] },
                                    objective: 'Mute all audio tracks.',
                                    constraints: [],
                                    scope: {
                                        targetIds: ['provider-invented'],
                                        targetRanges: [],
                                        protectedTargetIds: ['track-vocals'],
                                        protectedRanges: [],
                                    },
                                    capabilityIds: [],
                                    assetIds: [],
                                    alternatives: [],
                                    validationStrategy: ['Validate selector preconditions.'],
                                    stoppingConditions: ['Stop if the project revision changes.'],
                                },
                                list: {
                                    schemaVersion: 1,
                                    items: [
                                        {
                                            id: 'mute-audio-tracks',
                                            name: 'muteTrack',
                                            arguments: arguments_,
                                            selector: {
                                                targetArgument: 'trackId',
                                                entity: 'track',
                                                where: { kind: 'audio' },
                                                quantity: { unit: 'targets', exactly: 2 },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            ])
        );

        const result = await parsePromptToActions({
            prompt,
            context: createMixerContext(),
            projectRevision: 'revision-1',
        });

        expect(generateToolCalls).toHaveBeenCalledTimes(3);
        expect(result.actions).toEqual(expectedActions);
        if (expectedActions.length === 0) {
            expect(result.rejectionReason).toBeDefined();
            return;
        }
        expect(result.rejectionReason).toBeUndefined();
        expect(result.requiresConfirmation).toBe(true);
        expect(result.providerKnownTargetIds).toEqual(['track-vocals', 'track-guitar']);
        expect(result.providerProposal?.scope).toEqual({
            targetIds: ['track-vocals', 'track-guitar'],
            targetRanges: [],
            protectedTargetIds: [],
            protectedRanges: [],
        });
    });

    it('carries a match selector predicate record alongside the compiled actions for a match-based bulk selector', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            scriptedPlan(literalMetricIntakeTurn, [
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'catalog-mute-track',
                            name: 'agent.catalog.discover',
                            arguments: { category: 'command', names: ['muteTrack'] },
                        },
                    ],
                },
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'semantic-mute-tracks-match',
                            name: 'command.batch.propose',
                            arguments: {
                                plan: {
                                    semantic: { classification: 'simple', uncertainty: [] },
                                    objective: 'Mute all audio tracks.',
                                    constraints: [],
                                    scope: {
                                        targetIds: ['provider-invented'],
                                        targetRanges: [],
                                        protectedTargetIds: ['track-vocals'],
                                        protectedRanges: [],
                                    },
                                    capabilityIds: [],
                                    assetIds: [],
                                    alternatives: [],
                                    validationStrategy: ['Validate selector preconditions.'],
                                    stoppingConditions: ['Stop if the project revision changes.'],
                                },
                                list: {
                                    schemaVersion: 1,
                                    items: [
                                        {
                                            id: 'mute-audio-tracks-match',
                                            name: 'muteTrack',
                                            arguments: { muted: true },
                                            selector: {
                                                targetArgument: 'trackId',
                                                entity: 'track',
                                                match: { all: [{ kind: 'audio' }] },
                                                quantity: { unit: 'targets', exactly: 2 },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            ])
        );

        const result = await parsePromptToActions({
            prompt: 'mute all audio tracks',
            context: createMixerContext(),
            projectRevision: 'revision-1',
        });

        expect(generateToolCalls).toHaveBeenCalledTimes(3);
        expect(result.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true, expectedMuted: false } },
            { type: 'muteTrack', payload: { trackId: 'track-guitar', muted: true, expectedMuted: false } },
        ]);
        // Only a `match`-based selector produces compiler evidence with a `predicate`; a `where`-based
        // selector (the `it.each` cases above) never carries one — this is `parsePromptToActions`'s own
        // hand-off of that evidence into `matchSelectorPredicates`, one of the four carriers that must
        // not drop it on the way to a persisted confirmation.
        expect(result.matchSelectorPredicates).toEqual([
            {
                itemId: 'mute-audio-tracks-match',
                entity: 'track',
                match: { all: [{ kind: 'audio' }] },
                quantity: { unit: 'targets', exactly: 2 },
                stableIds: ['track-vocals', 'track-guitar'],
                actionPositions: [0, 1],
            },
        ]);
    });

    it('unions explicit and structural bulk protections across proposal, confirmation, and authority', async () => {
        const context = createBulkInsertionContext();
        const prompt =
            'Insert a compressor after EQ on every bass track, excluding frozen tracks, and keep Guitar unchanged.';
        vi.mocked(generateToolCalls).mockResolvedValue(
            scriptedPlan(literalMetricIntakeTurn, [
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            name: 'agent.catalog.discover',
                            arguments: { category: 'command', names: ['addDevice'] },
                        },
                    ],
                },
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            name: 'command.batch.propose',
                            arguments: {
                                plan: {
                                    semantic: { classification: 'simple', uncertainty: [] },
                                    objective: 'Insert compressors on the unfrozen bass tracks.',
                                    constraints: [],
                                    scope: {
                                        targetIds: ['provider-invented'],
                                        targetRanges: [],
                                        protectedTargetIds: ['track-bass-frozen'],
                                        protectedRanges: [],
                                    },
                                    capabilityIds: ['addDevice'],
                                    assetIds: [],
                                    alternatives: [],
                                    validationStrategy: [],
                                    stoppingConditions: [],
                                },
                                list: {
                                    schemaVersion: 1,
                                    items: [
                                        {
                                            id: 'insert-bass-di-compressor',
                                            name: 'addDevice',
                                            arguments: {
                                                deviceType: 'Compressor',
                                                afterDeviceId: 'track-bass-di-eq',
                                            },
                                            selector: {
                                                targetArgument: 'trackId',
                                                entity: 'track',
                                                where: { name: 'Bass DI' },
                                                quantity: { unit: 'targets', exactly: 1 },
                                            },
                                        },
                                        {
                                            id: 'insert-bass-amp-compressor',
                                            name: 'addDevice',
                                            arguments: {
                                                deviceType: 'Compressor',
                                                afterDeviceId: 'track-bass-amp-eq',
                                            },
                                            selector: {
                                                targetArgument: 'trackId',
                                                entity: 'track',
                                                where: { name: 'Bass Amp' },
                                                quantity: { unit: 'targets', exactly: 1 },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            ])
        );
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);

        const result = await parsePromptToActions({
            prompt,
            context,
            projectRevision: 'revision-bulk-protections',
        });
        const protectedTargetIds = ['track-bass-frozen', 'track-guitar'];

        expect(getExplicitClipProtection(prompt, context)).toEqual({ clips: [], complete: true });
        expect(result.rejectionReason).toBeUndefined();
        expect(result.providerProposal?.scope.targetIds).toEqual(result.providerKnownTargetIds);
        expect(result.providerProposal?.scope.protectedTargetIds).toEqual(protectedTargetIds);
        const confirmation = describePendingActionConfirmation({ actions: result.actions, context, prompt });
        expect(confirmation.protectedUnchanged.map((object) => object.id)).toEqual(protectedTargetIds);
        registerHandlerMap(getArrangementHandlers());
        const compiled = compilePlannedActionCommandBatch({
            actions: result.actions,
            actionLabels: confirmation.actionLabels,
            autoCommit: false,
            context,
            group: { groupId: 'bulk-protections', groupLabel: 'Bulk protections' },
            intent: prompt,
            projectRevision: 'revision-bulk-protections',
            protectedTargetIds: confirmation.protectedUnchanged.map((object) => object.id),
            runId: 'run-bulk-protections',
        });
        expect(compiled.commandBatch.authority.scope.protectedTargetIds).toEqual(protectedTargetIds);
    });

    it('unions explicit protections into exact application-resolved workflow authority', async () => {
        const context = createDrumRoutingContext();
        const prompt =
            'Route every drum track except the parallel-compression return into the Drum Bus, and keep Bass DI unchanged.';
        let bridgeReturnedScopeAuthority: boolean | undefined;
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [
                    { name: 'selectWorkflowCapability', arguments: { capabilityId: 'drum-routing' } },
                    { name: 'setTrackOutput', arguments: { trackId: 'track-kick', outputId: 'bus-drums' } },
                    { name: 'setTrackOutput', arguments: { trackId: 'track-snare', outputId: 'bus-drums' } },
                    { name: 'setTrackOutput', arguments: { trackId: 'track-hats', outputId: 'bus-drums' } },
                    { name: 'setTrackOutput', arguments: { trackId: 'track-room', outputId: 'bus-drums' } },
                ],
                literalMetricIntakeTurn
            )
        );
        mockBridgeGroundedLlmToolCalls.mockImplementation((input) => {
            const bridged = actualBridge.bridgeGroundedLlmToolCalls(input);
            bridgeReturnedScopeAuthority = Object.hasOwn(bridged, 'verifiedProviderProposalScope');
            return bridged;
        });

        const result = await parsePromptToActions({
            prompt,
            context,
            projectRevision: 'revision-workflow-protections',
        });
        const workflowTargetIds = ['bus-drums', 'track-kick', 'track-snare', 'track-hats', 'track-room'];
        const protectedTargetIds = ['track-bass', 'track-parallel'];

        expect(result.rejectionReason).toBeUndefined();
        expect(bridgeReturnedScopeAuthority).toBe(false);
        expect(result.providerProposal?.scope).toEqual({
            targetIds: workflowTargetIds,
            targetRanges: [],
            protectedTargetIds,
            protectedRanges: [],
        });
        const confirmation = describePendingActionConfirmation({
            actions: result.actions,
            context,
            prompt,
            workflowCapabilityId: result.workflowCapabilityId,
        });
        expect(confirmation.protectedUnchanged.map((object) => object.id)).toEqual(protectedTargetIds);
        registerHandlerMap(getArrangementHandlers());
        const compiled = compilePlannedActionCommandBatch({
            actions: result.actions,
            actionLabels: confirmation.actionLabels,
            autoCommit: false,
            context,
            group: { groupId: 'workflow-protections', groupLabel: 'Workflow protections' },
            intent: prompt,
            projectRevision: 'revision-workflow-protections',
            protectedTargetIds: confirmation.protectedUnchanged.map((object) => object.id),
            runId: 'run-workflow-protections',
        });
        expect([...compiled.commandBatch.authority.scope.targetIds].sort()).toEqual([...workflowTargetIds].sort());
        expect(compiled.commandBatch.authority.scope.targetRanges).toEqual([]);
        expect(compiled.commandBatch.authority.scope.protectedTargetIds).toEqual(protectedTargetIds);
        expect(compiled.commandBatch.authority.scope.protectedRanges).toEqual([]);
    });

    it('materializes compiler-owned binding scope and preserves its action graph', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            scriptedPlan(literalMetricIntakeTurn, [
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            name: 'agent.catalog.discover',
                            arguments: { category: 'command', names: ['createBus', 'setTrackGain'] },
                        },
                    ],
                },
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            name: 'command.batch.propose',
                            arguments: {
                                plan: {
                                    semantic: { classification: 'simple', uncertainty: [] },
                                    objective: 'Create and gain a drum bus.',
                                    constraints: [],
                                    scope: {
                                        targetIds: [],
                                        targetRanges: [],
                                        protectedTargetIds: [],
                                        protectedRanges: [],
                                    },
                                    capabilityIds: ['createBus', 'setTrackGain'],
                                    assetIds: [],
                                    alternatives: [],
                                    validationStrategy: ['Validate the dependency graph.'],
                                    stoppingConditions: ['Stop if the revision changes.'],
                                },
                                list: {
                                    schemaVersion: 1,
                                    items: [
                                        {
                                            id: 'create-drum-bus',
                                            name: 'createBus',
                                            arguments: { name: 'Drum Bus', binding: 'drum-bus' },
                                        },
                                        {
                                            id: 'gain-drum-bus',
                                            name: 'setTrackGain',
                                            arguments: { trackId: '$drum-bus', gain: 0.8 },
                                            dependsOn: ['create-drum-bus'],
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            ])
        );

        const result = await parsePromptToActions({
            prompt: 'Create a Drum Bus, then set its gain to 0.8.',
            context: baseContext,
            projectRevision: 'revision-binding',
        });

        expect(result.rejectionReason).toBeUndefined();
        expect(result.actionCommandGraph).toEqual({
            dependenciesByActionIndex: [[], [0]],
            batchLocalBindings: [{ bindingId: '$drum-bus', producerActionIndex: 0, producerArgument: 'busId' }],
        });
        const createdBusId = result.actions[0]?.type === 'createBus' ? result.actions[0].payload.busId : undefined;
        expect(createdBusId).toMatch(/^bus-ai-/u);
        expect(result.actions[1]).toMatchObject({
            type: 'setTrackGain',
            payload: { trackId: createdBusId, gain: 0.8 },
        });
        expect(result.providerProposal?.scope.targetIds).toEqual([]);
        expect(result.providerKnownTargetIds).toEqual([]);
    });

    it('rejects a selected application-expanded workflow before its compiler graph can reach partial acceptance', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            scriptedPlan(literalMetricIntakeTurn, [
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            name: 'agent.catalog.discover',
                            arguments: { category: 'command', names: ['setMetronomeEnabled'] },
                        },
                    ],
                },
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            name: 'selectWorkflowCapability',
                            arguments: { capabilityId: 'shared-vocal-fx-buses' },
                        },
                        {
                            name: 'command.batch.propose',
                            arguments: {
                                plan: {
                                    semantic: { classification: 'simple', uncertainty: [] },
                                    objective: 'Enable the metronome.',
                                    constraints: [],
                                    scope: {
                                        targetIds: [],
                                        targetRanges: [],
                                        protectedTargetIds: [],
                                        protectedRanges: [],
                                    },
                                    capabilityIds: ['setMetronomeEnabled'],
                                    assetIds: [],
                                    alternatives: [],
                                    validationStrategy: ['Validate the command graph.'],
                                    stoppingConditions: ['Stop if graph preservation is unavailable.'],
                                },
                                list: {
                                    schemaVersion: 1,
                                    items: [
                                        {
                                            id: 'enable-metronome',
                                            name: 'setMetronomeEnabled',
                                            arguments: { enabled: true },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            ])
        );

        const result = await parsePromptToActions({
            prompt: 'Enable the metronome while preparing shared vocal FX buses.',
            context: baseContext,
            projectRevision: 'revision-specialized-graph',
        });

        expect(mockBridgeGroundedLlmToolCalls).toHaveBeenCalledWith(
            expect.objectContaining({
                calls: [{ name: 'setMetronomeEnabled', arguments: { enabled: true } }],
                compilerEvidence: expect.objectContaining({
                    snapshotRevision: 'revision-specialized-graph',
                }),
                workflowCapabilityId: 'shared-vocal-fx-buses',
            })
        );
        expect(result).toMatchObject({
            actions: [],
            requiresConfirmation: false,
            rejectionReason:
                'Provider action rejected: <batch>: Compiler command graphs cannot enter application-expanded specialized workflows',
        });
        expect(result.actionCommandGraph).toBeUndefined();
    });

    it('rejects a fast-path plan before confirmation when it conflicts with locked production intent', async () => {
        vi.mocked(tryParameterizedPath).mockReturnValue([{ type: 'setTempo', payload: { bpm: 128 } }]);
        mockDoesProductionBriefAllowActionBatch.mockReturnValue(false);

        const result = await parsePromptToActions({ prompt: 'set tempo to 128', context: baseContext });

        expect(mockDoesProductionBriefAllowActionBatch).toHaveBeenCalledWith([
            { type: 'setTempo', payload: { bpm: 128 } },
        ]);
        expect(result).toEqual({
            actions: [],
            rawText: 'set tempo to 128',
            requiresConfirmation: false,
            rejectionReason: 'Recognized command conflicts with locked production intent.',
            planningOutcome: {
                kind: 'denied',
                reason: 'Recognized command conflicts with locked production intent.',
            },
        });
    });

    it('should return empty intent when signal is aborted before LLM path', async () => {
        const controller = new AbortController();
        controller.abort();

        const result = await parsePromptToActions({
            prompt: 'anything',
            context: baseContext,
            signal: controller.signal,
        });

        expect(result).toEqual({
            actions: [],
            rawText: 'anything',
            requiresConfirmation: false,
            planningOutcome: { kind: 'no-match' },
        });
    });

    it('keeps deterministic commands available when provider planning is disabled', async () => {
        vi.mocked(tryParameterizedPath).mockReturnValue([{ type: 'setTempo', payload: { bpm: 128 } }]);

        const result = await parsePromptToActions({
            prompt: 'set tempo to 128',
            context: baseContext,
            providerPlanning: 'disabled',
        });

        expect(result).toMatchObject({
            actions: [{ type: 'setTempo', payload: { bpm: 128 } }],
            planningOutcome: { kind: 'proposal' },
        });
        expect(generateToolCalls).not.toHaveBeenCalled();
    });

    it('returns actionable availability without invoking a provider when provider planning is disabled', async () => {
        const result = await parsePromptToActions({
            prompt: 'make the chorus feel warmer',
            context: baseContext,
            providerPlanning: 'disabled',
        });

        expect(result).toEqual({
            actions: [],
            rawText: 'make the chorus feel warmer',
            requiresConfirmation: false,
            planningOutcome: {
                kind: 'denied',
                reason: 'No AI backend is available for this request. Configure a hosted provider in the desktop app or use a WebGPU-capable browser.',
            },
        });
        expect(generateToolCalls).not.toHaveBeenCalled();
    });

    it.each([
        { prompt: 'save project', actionType: 'saveProject' },
        { prompt: 'new project', actionType: 'newProject' },
        { prompt: 'export', actionType: 'exportProject' },
        { prompt: 'import audio', actionType: 'importAudioFile' },
        { prompt: 'import midi', actionType: 'importMidiFile' },
        { prompt: 'leave session', actionType: 'leaveCollabSession' },
    ] as const)('recognizes denied intent $prompt without provider planning', async ({ prompt, actionType }) => {
        const result = await parsePromptToActions({ prompt, context: baseContext });

        expect(result).toEqual({
            actions: [],
            rawText: prompt,
            requiresConfirmation: false,
            rejectionReason: `Action ${actionType} cannot be executed by AI because it does not report completion.`,
            planningOutcome: {
                kind: 'denied',
                reason: `Action ${actionType} cannot be executed by AI because it does not report completion.`,
            },
        });
        expect(generateToolCalls).not.toHaveBeenCalled();
    });

    it('turns provider tool calls into validated proposals against the frozen planning context', async () => {
        const currentContext = { ...baseContext, tempo: 121 };
        vi.mocked(getProjectContext).mockReturnValue(currentContext);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setTempo', arguments: { bpm: 128 } }], literalMetricIntakeTurn)
        );
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [{ type: 'setTempo', payload: { bpm: 128 } }],
            rejections: [],
        });

        const prompt = 'set the project tempo to 128';
        const result = await parsePromptToActions({ prompt, context: baseContext });

        const firstProviderCall = vi.mocked(generateToolCalls).mock.calls[0];
        expect(firstProviderCall?.[0]).toContain('command system prompt');
        expect(firstProviderCall?.[1]).toContain('fixed_policy:');
        expect(firstProviderCall?.[2]).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    function: expect.objectContaining({ name: 'selectCreativeInterpretation' }),
                }),
            ])
        );
        expect(firstProviderCall?.[2]).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ function: expect.objectContaining({ name: 'selectWorkflowCapability' }) }),
            ])
        );
        expect(vi.mocked(generateToolCalls).mock.calls[1]?.[2]).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    function: expect.objectContaining({ name: 'agent.catalog.discover' }),
                }),
                expect.objectContaining({
                    function: expect.objectContaining({
                        name: 'selectWorkflowCapability',
                        parameters: expect.objectContaining({
                            properties: { capabilityId: expect.any(Object) },
                            required: ['capabilityId'],
                            additionalProperties: false,
                        }),
                    }),
                }),
            ])
        );
        expect(firstProviderCall?.[4]).toBe(prompt);
        expect(mockBridgeGroundedLlmToolCalls).toHaveBeenCalledWith({
            calls: [{ name: 'setTempo', arguments: { bpm: 128 } }],
            context: baseContext,
            markerSignatures: [],
            sectionSignatures: [],
            prompt,
            protectionFacts: { protectedUnchanged: [], protectedControls: [] },
        });
        expect(result.actions).toEqual([{ type: 'setTempo', payload: { bpm: 128 } }]);
        expect(result.executionMode).toBe('atomic');
        expect(baseContext.tempo).toBe(120);
        expect(currentContext.tempo).toBe(121);
    });

    it('passes the persisted selected alternative as typed context to the provider planning request', async () => {
        const scope = { targetIds: ['track-vocals'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] };
        const grants = {
            allowedOperationPrefixes: ['muteTrack'],
            create: false,
            delete: false,
            routing: false,
            tempo: false,
            master: false,
            file: false,
            audioUpload: false,
            remoteGeneration: false,
            autoCommit: false,
        };
        agentRunLifecycle.create({
            runId: 'resumed-planning-attempt',
            request: 'Mute vocals.',
            mode: 'plan',
            createdRevision: 'revision-resume',
            scope,
            grants,
            budgets: { limits: { localAnalysis: 100 }, consumed: { localAnalysis: 1 } },
            resume: {
                sourceRunId: 'source-decision',
                decisionId: 'decision-vocals',
                selectedAlternativeId: 'mute-vocals',
                selectedAlternative: { id: 'mute-vocals', label: 'Mute vocals only', changesAuthority: false },
                proposalIdentity: 'proposal-vocals',
                capabilitySchemaIdentity: 'catalog-v1',
                revision: 'revision-resume',
                scope,
                grants,
                budgets: { limits: { localAnalysis: 100 }, consumed: { localAnalysis: 1 } },
            },
        });
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setTempo', arguments: { bpm: 128 } }], literalMetricIntakeTurn)
        );
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [{ type: 'setTempo', payload: { bpm: 128 } }],
            rejections: [],
        });

        await parsePromptToActions({
            prompt: 'Mute vocals.',
            context: baseContext,
            projectRevision: 'revision-resume',
            streamIdentity: {
                runId: 'resumed-planning-attempt',
                requestId: 'request-resume',
                cancellationGeneration: 0,
            },
            onProviderAttempt: () => ({ status: 'admitted' }),
        });

        const firstProviderCall = vi.mocked(generateToolCalls).mock.calls[0];
        expect(firstProviderCall?.[0]).toContain('Mute vocals only');
        expect(firstProviderCall?.[0]).toContain('source-decision');
        expect(firstProviderCall?.[1]).toContain('Mute vocals only');
    });

    it('rejects a provider plan before confirmation when it conflicts with locked production intent', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setTempo', arguments: { bpm: 128 } }], literalMetricIntakeTurn)
        );
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [{ type: 'setTempo', payload: { bpm: 128 } }],
            rejections: [],
        });
        mockDoesProductionBriefAllowActionBatch.mockReturnValue(false);

        const result = await parsePromptToActions({ prompt: 'set the project tempo to 128', context: baseContext });

        expect(mockDoesProductionBriefAllowActionBatch).toHaveBeenCalledWith([
            { type: 'setTempo', payload: { bpm: 128 } },
        ]);
        expect(result).toMatchObject({
            actions: [],
            rawText: 'set the project tempo to 128',
            requiresConfirmation: false,
            rejectionReason: 'Provider action conflicts with locked production intent.',
        });
        expect(result.applicationToolReceipts).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ toolName: 'selectCreativeInterpretation', status: 'success' }),
                expect.objectContaining({ toolName: 'agent.catalog.discover', status: 'success' }),
            ])
        );
    });

    it('refuses a planned decibel point on a device parameter lane the same plan creates before any proposal', async () => {
        const laneId = 'automation-ai-00000000-0000-4000-8000-00000000d001';
        const laneArguments = {
            trackId: 'track-vocals',
            parameterId: 'device-drive:dist-drive',
            parameterName: 'Distortion → Drive',
        };
        const pointArguments = { laneId, beat: 0, valueDb: -6 };
        vi.mocked(getProjectContext).mockReturnValue(createMixerContext());
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [
                    { name: 'addAutomationLane', arguments: laneArguments },
                    { name: 'addAutomationPoint', arguments: pointArguments },
                ],
                literalMetricIntakeTurn
            )
        );
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [
                { type: 'addAutomationLane', payload: laneArguments },
                { type: 'addAutomationPoint', payload: pointArguments },
            ],
            rejections: [],
            batchLocalActionIdentities: [{ actionOrdinal: 0, actionType: 'addAutomationLane', laneId }],
        });

        const result = await parsePromptToActions({
            prompt: 'Add automation lane for Distortion Drive on Vocals at -6 dB',
            context: createMixerContext(),
        });

        expect(result).toMatchObject({
            actions: [],
            requiresConfirmation: false,
            rejectionReason: 'Provider action failed runtime validation: addAutomationPoint',
        });
    });

    it('carries the normalized provider proposal for an accepted stem-import workflow action', async () => {
        const expectedProviderProposal = {
            semantic: { classification: 'complex', uncertainty: [] },
            objective: 'Import the prepared stems and create the starting mix.',
            constraints: ['Use only the prepared stem selection.'],
            scope: {
                targetIds: ['selection-stems'],
                targetRanges: [],
                protectedTargetIds: ['track-existing'],
                protectedRanges: [],
            },
            capabilityIds: ['importStemSet'],
            assetIds: ['stem-kick', 'stem-bass'],
            alternatives: [],
            validationStrategy: ['Validate the prepared stem selection before confirmation.'],
            stoppingConditions: ['Stop before mutation if the prepared selection no longer matches.'],
        } satisfies AgentRunProviderProposal;
        const providerPlanWithRawOnlyField = {
            ...expectedProviderProposal,
            rawProviderOnlyField: 'must not be forwarded as authority',
        };
        const stemImportCommand = {
            name: 'importStemSet',
            arguments: {
                selectionId: 'selection-stems',
                groupName: 'Imported Stems',
                stems: [
                    { stemId: 'stem-kick', role: 'kick' },
                    { stemId: 'stem-bass', role: 'bass' },
                ],
            },
        };
        vi.mocked(generateToolCalls).mockResolvedValue(
            scriptedPlan(nonAcousticMetricIntakeTurn({ modeId: 'create', creationSlotObjectTypes: ['track'] }), [
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            name: 'agent.catalog.discover',
                            arguments: { category: 'command', names: ['importStemSet'] },
                        },
                    ],
                },
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            name: 'selectWorkflowCapability',
                            arguments: { capabilityId: 'stem-import-starting-mix' },
                        },
                        {
                            name: 'command.batch.propose',
                            arguments: {
                                commands: [stemImportCommand],
                                plan: providerPlanWithRawOnlyField,
                            },
                        },
                    ],
                },
            ])
        );

        const result = await parsePromptToActions({
            prompt: 'Import the prepared stems and build a starting mix',
            context: baseContext,
            projectRevision: 'revision-stem-import',
            stemImportScope: stemImportPromptScope,
        });

        expect(result.actions).toHaveLength(1);
        expect(result.actions[0]).toMatchObject({
            type: 'importStemSet',
            payload: {
                selectionId: 'selection-stems',
                groupName: 'Imported Stems',
            },
        });
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
        expect(result.workflowCapabilityId).toBe('stem-import-starting-mix');
        expect(result.providerProposal).toEqual(expectedProviderProposal);
    });

    it('proposes an explicit provider time-signature command as one confirmable atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }],
                literalMetricIntakeTurn
            )
        );

        const result = await parsePromptToActions({ prompt: 'set time signature to 7/8', context: baseContext });

        expect(result.actions).toEqual([{ type: 'setTimeSignature', payload: { numerator: 7, denominator: 8 } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes an explicit provider stop command even when visible playback is already stopped', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'stopPlayback', arguments: {} }], literalMetricIntakeTurn)
        );

        const result = await parsePromptToActions({
            prompt: 'please stop the transport',
            context: {
                ...baseContext,
                isPlaying: false,
                isRecording: false,
            },
        });

        expect(result.actions).toEqual([{ type: 'stopPlayback' }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes an explicit provider playhead seek as one confirmable atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'seekPlayhead', arguments: { beat: 8.5 } }], literalMetricIntakeTurn)
        );

        const result = await parsePromptToActions({ prompt: 'seek the playhead to beat 8.5', context: baseContext });

        expect(result.actions).toEqual([{ type: 'seekPlayhead', payload: { beat: 8.5 } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('routes one explicit clip loop-length request through the provider-neutral grounded path', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [{ name: 'setClipLoopLength', arguments: { clipId: 'clip-intro', loopLength: 4 } }],
                literalMetricIntakeTurn
            )
        );
        const providerContext = createGlueProviderContext();

        const result = await parsePromptToActions({
            prompt: 'set the Intro clip loop length to 4 beats',
            context: {
                ...providerContext,
                selectedClipId: 'clip-intro',
                selectedClipIds: ['clip-intro'],
            },
        });

        expect(result.actions).toEqual([
            { type: 'setClipLoopLength', payload: { clipId: 'clip-intro', loopLength: 4 } },
        ]);
        expect(result.requiresConfirmation).toBe(false);
        expect(result.executionMode).toBe('atomic');
    });

    it('routes one explicit punch endpoint through the provider-neutral grounded action path', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setPunchIn', arguments: { beat: 20 } }], literalMetricIntakeTurn)
        );

        const result = await parsePromptToActions({ prompt: 'set punch in at beat 20', context: baseContext });

        expect(result.actions).toEqual([{ type: 'setPunchIn', payload: { beat: 20 } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('routes explicit punch enablement through the provider-neutral grounded action path', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setPunchEnabled', arguments: { enabled: true } }], literalMetricIntakeTurn)
        );

        const result = await parsePromptToActions({
            prompt: 'enable punch in/out',
            context: {
                ...baseContext,
                punchInEnabled: false,
            },
        });

        expect(result.actions).toEqual([{ type: 'setPunchEnabled', payload: { enabled: true } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
        const firstProviderCall = vi.mocked(generateToolCalls).mock.calls[0];
        expect(firstProviderCall?.[0]).toContain('command system prompt');
        expect(firstProviderCall?.[1]).toContain('untrusted_project_data:');
        expect(firstProviderCall?.[2]).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    function: expect.objectContaining({ name: 'selectCreativeInterpretation' }),
                }),
                expect.objectContaining({
                    function: expect.objectContaining({ name: 'agent.catalog.discover' }),
                }),
            ])
        );
        expect(firstProviderCall?.[2]).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ function: expect.objectContaining({ name: 'selectWorkflowCapability' }) }),
            ])
        );
        expect(vi.mocked(generateToolCalls).mock.calls[1]?.[2]).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    function: expect.objectContaining({
                        name: 'selectWorkflowCapability',
                        parameters: expect.objectContaining({
                            properties: { capabilityId: expect.any(Object) },
                            required: ['capabilityId'],
                            additionalProperties: false,
                        }),
                    }),
                }),
            ])
        );
        expect(firstProviderCall?.[4]).toBe('enable punch in/out');
    });

    it('bounds persisted validation failures before the normalized provider request', async () => {
        agentRunLifecycle.create({
            runId: 'run-with-failures',
            request: 'enable punch in/out',
            mode: 'plan',
            createdRevision: 'revision-1',
        });
        for (let index = 0; index < 24; index += 1) {
            agentRunLifecycle.recordError({
                runId: 'run-with-failures',
                error: {
                    code: `failure-${index}`,
                    message: 'safe stored failure',
                    occurredAt: index + 1,
                    retriable: false,
                    workId: null,
                },
            });
        }
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setPunchEnabled', arguments: { enabled: true } }], literalMetricIntakeTurn)
        );

        await parsePromptToActions({
            prompt: 'enable punch in/out',
            context: baseContext,
            projectRevision: 'revision-2',
            streamIdentity: {
                runId: 'run-with-failures',
                requestId: 'request-1',
                cancellationGeneration: 0,
            },
        });

        const message = vi.mocked(generateToolCalls).mock.calls[0]?.[1];
        expect(message).toContain('failure-23');
        expect(message).not.toContain('failure-0');
        expect(message).toContain('"omitted":8');
    });

    it('proposes a grounded provider marker as one reversible atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'addMarker', arguments: { beat: 16, name: 'Chorus' } }], literalMetricIntakeTurn)
        );

        const result = await parsePromptToActions({
            prompt: 'add a marker at beat 16 named Chorus',
            context: baseContext,
        });

        expect(result.actions).toEqual([{ type: 'addMarker', payload: { beat: 16, name: 'Chorus' } }]);
        expect(result.requiresConfirmation).toBe(false);
        expect(result.executionMode).toBe('atomic');
    });

    it('rejects a provider marker retry from local state without serializing markers to the provider', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        markerStoreValue.value = {
            markers: [{ id: 'marker-internal', beat: 16, name: 'Chorus', color: 'oklch(0.40 0.07 200)' }],
            sections: [],
        };
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'addMarker', arguments: { beat: 16, name: 'Chorus' } }], literalMetricIntakeTurn)
        );

        const prompt = 'add a marker at beat 16 named Chorus';
        const result = await parsePromptToActions({ prompt, context: baseContext });

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toBe(
            'Provider action rejected: addMarker: Requested marker already exists at that beat'
        );
        expect(vi.mocked(generateToolCalls).mock.calls[0]?.[1]).not.toContain('marker-internal');
    });

    it('resolves a provider marker removal from local state without serializing marker identity', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        markerStoreValue.value = {
            markers: [{ id: 'marker-internal', beat: 16, name: 'Chorus', color: 'oklch(0.40 0.07 200)' }],
            sections: [],
        };
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'removeMarker', arguments: { beat: 16, name: 'Chorus' } }], literalMetricIntakeTurn)
        );

        const result = await parsePromptToActions({ prompt: 'delete marker Chorus at beat 16', context: baseContext });

        expect(result.actions).toEqual([{ type: 'removeMarker', payload: { markerId: 'marker-internal' } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(vi.mocked(generateToolCalls).mock.calls[0]?.[1]).not.toContain('marker-internal');
    });

    it('resolves a provider marker color from local state without serializing marker identity', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        markerStoreValue.value = {
            markers: [{ id: 'marker-internal', beat: 16, name: 'Chorus', color: 'oklch(0.40 0.07 200)' }],
            sections: [],
        };
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [{ name: 'setMarkerColor', arguments: { beat: 16, name: 'Chorus', color: 'amber' } }],
                literalMetricIntakeTurn
            )
        );

        const prompt = 'set marker color for Chorus at beat 16 to amber';
        const result = await parsePromptToActions({ prompt, context: baseContext });

        expect(result.actions).toEqual([
            {
                type: 'setMarkerColor',
                payload: { markerId: 'marker-internal', color: 'oklch(0.40 0.08 70)' },
            },
        ]);
        expect(result.requiresConfirmation).toBe(false);
        expect(vi.mocked(generateToolCalls).mock.calls[0]?.[1]).not.toContain('marker-internal');
    });

    it('resolves a provider section removal from local state without serializing section identity', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        markerStoreValue.value = {
            markers: [],
            sections: [{ id: 'section-internal', startBeat: 8, endBeat: 16, name: 'Verse' }],
        };
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [{ name: 'removeSection', arguments: { startBeat: 8, endBeat: 16, name: 'Verse' } }],
                literalMetricIntakeTurn
            )
        );

        const prompt = 'remove the section named Verse from beat 8 to beat 16';
        const result = await parsePromptToActions({ prompt, context: baseContext });

        expect(result.actions).toEqual([{ type: 'removeSection', payload: { sectionId: 'section-internal' } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(vi.mocked(generateToolCalls).mock.calls[0]?.[1]).not.toContain('section-internal');
    });

    it('proposes grounded non-destructive clip normalization as one atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const proposal = completePlan(
            [{ name: 'normalizeClip', arguments: { clipId: 'clip-intro', mode: 'lufs', targetDb: -14 } }],
            literalMetricIntakeTurn,
            true
        );
        let turn = 0;
        vi.mocked(generateToolCalls).mockImplementation(async (_system, userMessage, schemas) => {
            turn += 1;
            if (turn === 1) {
                return { status: 'complete', toolCalls: literalMetricIntakeTurn(userMessage, schemas) };
            }
            return proposal;
        });
        const providerContext: ProjectContext = {
            ...baseContext,
            tracks: [
                {
                    id: 'track-vocals',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 1,
                    deviceCount: 0,
                    clips: [
                        {
                            id: 'clip-intro',
                            name: 'Intro',
                            type: 'audio',
                            startBeat: 0,
                            endBeat: 8,
                            gain: 1,
                            locked: false,
                            noteCount: 0,
                        },
                    ],
                    devices: [],
                    sends: [],
                },
            ],
            selectedTrackId: 'track-vocals',
            selectedClipId: 'clip-intro',
            selectedClipIds: ['clip-intro'],
        };

        const result = await parsePromptToActions({
            prompt: 'normalize the Intro clip to -14 LUFS',
            context: providerContext,
        });

        expect(result.actions).toEqual([
            { type: 'normalizeClip', payload: { clipId: 'clip-intro', mode: 'lufs', targetDb: -14 } },
        ]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
        expect(turn).toBe(3);
    });

    it('proposes grounded non-destructive clip stretch controls as atomic actions', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const plans = [
            completePlan(
                [{ name: 'setClipStretchRatio', arguments: { clipId: 'clip-intro', ratio: 1.5 } }],
                literalMetricIntakeTurn
            ),
            completePlan(
                [{ name: 'setClipStretchMode', arguments: { clipId: 'clip-intro', mode: 'timestretch' } }],
                literalMetricIntakeTurn
            ),
            completePlan(
                [{ name: 'fitClipToBeats', arguments: { clipId: 'clip-intro', targetBeats: 4 } }],
                literalMetricIntakeTurn
            ),
        ];
        let planIndex = 0;
        vi.mocked(generateToolCalls).mockImplementation(async () => {
            const plan = plans[Math.floor(planIndex / 3)];
            planIndex += 1;
            return plan;
        });
        const providerContext: ProjectContext = {
            ...baseContext,
            tracks: [
                {
                    id: 'track-vocals',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 1,
                    deviceCount: 0,
                    clips: [
                        {
                            id: 'clip-intro',
                            name: 'Intro',
                            type: 'audio',
                            startBeat: 0,
                            endBeat: 8,
                            gain: 1,
                            locked: false,
                            noteCount: 0,
                        },
                    ],
                    devices: [],
                    sends: [],
                },
            ],
            selectedTrackId: 'track-vocals',
            selectedClipId: 'clip-intro',
            selectedClipIds: ['clip-intro'],
        };

        const result = await parsePromptToActions({
            prompt: 'set the Intro clip stretch ratio to 1.5',
            context: providerContext,
        });
        const modeResult = await parsePromptToActions({
            prompt: 'set the Intro clip stretch mode to timestretch',
            context: providerContext,
        });
        const fitResult = await parsePromptToActions({
            prompt: 'fit the Intro clip duration to 4 beats',
            context: providerContext,
        });

        expect(result.actions).toEqual([
            { type: 'setClipStretchRatio', payload: { clipId: 'clip-intro', ratio: 1.5 } },
        ]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
        expect(modeResult.actions).toEqual([
            { type: 'setClipStretchMode', payload: { clipId: 'clip-intro', mode: 'timestretch' } },
        ]);
        expect(modeResult.requiresConfirmation).toBe(true);
        expect(modeResult.executionMode).toBe('atomic');
        expect(fitResult.actions).toEqual([
            { type: 'fitClipToBeats', payload: { clipId: 'clip-intro', targetBeats: 4 } },
        ]);
        expect(fitResult.requiresConfirmation).toBe(true);
        expect(fitResult.executionMode).toBe('atomic');
    });

    it('proposes a grounded cross-track clip move as one atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [
                    {
                        name: 'moveClip',
                        arguments: { clipId: 'clip-intro', trackId: 'track-guitar', startBeat: 16 },
                    },
                ],
                literalMetricIntakeTurn
            )
        );
        const vocals = {
            id: 'track-vocals',
            name: 'Vocals',
            kind: 'audio' as const,
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read' as const,
            outputId: 'master',
            clipCount: 1,
            deviceCount: 0,
            clips: [
                {
                    id: 'clip-intro',
                    name: 'Intro',
                    type: 'audio' as const,
                    startBeat: 0,
                    endBeat: 8,
                    gain: 1,
                    locked: false,
                    noteCount: 0,
                },
            ],
            devices: [],
            sends: [],
        };
        const providerContext: ProjectContext = {
            ...baseContext,
            tracks: [vocals, { ...vocals, id: 'track-guitar', name: 'Guitar', clipCount: 0, clips: [] }],
            selectedTrackId: 'track-vocals',
            selectedClipId: 'clip-intro',
            selectedClipIds: ['clip-intro'],
        };

        const result = await parsePromptToActions({
            prompt: 'move the Intro clip to Guitar at beat 16',
            context: providerContext,
        });

        expect(result.actions).toEqual([
            { type: 'moveClip', payload: { clipId: 'clip-intro', trackId: 'track-guitar', startBeat: 16 } },
        ]);
        expect(result.requiresConfirmation).toBe(false);
        expect(result.executionMode).toBe('atomic');
    });

    it('keeps every planned action when one of them cannot compile for range measurement', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            scriptedPlan(literalMetricIntakeTurn, [
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            name: 'agent.catalog.discover',
                            arguments: { category: 'command', names: ['setLoopRegion', 'setTempo'] },
                        },
                    ],
                },
                {
                    status: 'complete',
                    toolCalls: [
                        {
                            name: 'command.batch.propose',
                            arguments: {
                                plan: {
                                    semantic: { classification: 'simple', uncertainty: [] },
                                    objective: 'Set the loop region and the tempo.',
                                    constraints: [],
                                    scope: {
                                        targetIds: [],
                                        targetRanges: [],
                                        protectedTargetIds: [],
                                        protectedRanges: [],
                                    },
                                    capabilityIds: ['setLoopRegion', 'setTempo'],
                                    assetIds: [],
                                    alternatives: [],
                                    validationStrategy: ['Validate the grounded command batch.'],
                                    stoppingConditions: ['Stop if application validation fails.'],
                                },
                                list: {
                                    schemaVersion: 1,
                                    items: [
                                        {
                                            id: 'set-loop-region',
                                            name: 'setLoopRegion',
                                            arguments: { startBeat: 8, endBeat: 16 },
                                        },
                                        { id: 'set-tempo', name: 'setTempo', arguments: { bpm: 130 } },
                                    ],
                                },
                            },
                        },
                    ],
                },
            ])
        );
        // Measuring the plan's beat spans compiles every planned action through the batch compiler.
        // One handler refuses to materialize a reference the project never seeded — the shape a
        // hallucinated provider target takes at parse time — so only the other action is measurable.
        registerHandlerMap({
            setLoopRegion: {
                describe: () => ({ label: 'Set loop region', inverseAction: null }),
                execute: () => undefined,
                undoable: true,
            },
            setTempo: {
                materializeCommandArguments: () => {
                    throw new Error('Tempo reference does not resolve in the current project');
                },
                describe: () => ({ label: 'Set tempo', inverseAction: null }),
                execute: () => undefined,
                undoable: true,
            },
        });

        const result = await parsePromptToActions({
            prompt: 'set the loop region from beat 8 to beat 16 and set the tempo to 130',
            context: createMixerContext(),
            projectRevision: 'revision-partial-measurement',
        });

        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toEqual([
            { type: 'setLoopRegion', payload: { startBeat: 8, endBeat: 16 } },
            { type: 'setTempo', payload: { bpm: 130 } },
        ]);
        expect(result.providerProposal?.scope.targetRanges).toEqual([{ startBeat: 8, endBeat: 16 }]);
    });

    it('proposes a grounded two-clip crossfade as one confirmable atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [{ name: 'crossfadeClips', arguments: { clipAId: 'clip-intro', clipBId: 'clip-chorus' } }],
                literalMetricIntakeTurn
            )
        );
        const clip = {
            id: 'clip-intro',
            name: 'Intro',
            type: 'audio' as const,
            startBeat: 0,
            endBeat: 8,
            gain: 1,
            locked: false,
            noteCount: 0,
        };
        const providerContext: ProjectContext = {
            ...baseContext,
            tracks: [
                {
                    id: 'track-vocals',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 2,
                    deviceCount: 0,
                    clips: [{ ...clip }, { ...clip, id: 'clip-chorus', name: 'Chorus', startBeat: 8, endBeat: 16 }],
                    devices: [],
                    sends: [],
                },
            ],
            selectedTrackId: 'track-vocals',
            selectedClipId: clip.id,
            selectedClipIds: [clip.id],
        };

        const result = await parsePromptToActions({ prompt: 'crossfade Intro into Chorus', context: providerContext });

        expect(result.actions).toEqual([
            { type: 'crossfadeClips', payload: { clipAId: 'clip-intro', clipBId: 'clip-chorus' } },
        ]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes grounded MIDI clip glue as one destructive confirmable atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [{ name: 'glueClips', arguments: { clipIds: ['clip-intro', 'clip-verse'] } }],
                literalMetricIntakeTurn
            )
        );
        const clip = {
            id: 'clip-intro',
            name: 'Intro',
            type: 'midi' as const,
            startBeat: 0,
            endBeat: 8,
            gain: 1,
            locked: false,
            muted: false,
            loopEnabled: false,
            noteCount: 4,
        };
        const providerContext: ProjectContext = {
            ...baseContext,
            glueEligibleClipPairs: [['clip-intro', 'clip-verse']],
            tracks: [
                {
                    id: 'track-midi',
                    name: 'Keys',
                    kind: 'midi',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 2,
                    deviceCount: 0,
                    clips: [{ ...clip }, { ...clip, id: 'clip-verse', name: 'Verse', startBeat: 8, endBeat: 16 }],
                    devices: [],
                    sends: [],
                },
            ],
            selectedTrackId: 'track-midi',
            selectedClipId: clip.id,
            selectedClipIds: [clip.id, 'clip-verse'],
        };

        const result = await parsePromptToActions({
            prompt: 'glue the Intro and Verse clips',
            context: providerContext,
        });

        expect(result.actions).toEqual([{ type: 'glueClips', payload: { clipIds: ['clip-intro', 'clip-verse'] } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it.each([
        "glue Intro and Verse clips, but don't glue them due to phase issues, then set tempo to 130",
        "glue Intro and Verse clips, actually don't because the phase is wrong, then set tempo to 130",
        'glue Intro and Verse clips, but keep them separate for comping, then set tempo to 130',
        'glue Intro and Verse clips, without making changes because this is a dry run, then set tempo to 130',
        'glue Intro and Verse clips, never mind because the phase is wrong, then set tempo to 130',
        'glue Intro and Verse clips, then cancel it because the timing is wrong, then set tempo to 130',
        'glue Intro and Verse clips, then cancel that command because the timing is wrong, then set tempo to 130',
        'glue Intro and Verse clips, then cancel this command because the timing is wrong, then set tempo to 130',
        'glue Intro and Verse clips, then cancel that request because the timing is wrong, then set tempo to 130',
        'glue Intro and Verse clips, then cancel this request because the timing is wrong, then set tempo to 130',
    ])('omits a cancelled provider glue call and keeps an unrelated grounded action', async (prompt) => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [
                    { name: 'glueClips', arguments: { clipIds: ['clip-intro', 'clip-verse'] } },
                    { name: 'setTempo', arguments: { bpm: 130 } },
                ],
                nonAcousticMetricIntakeTurn({
                    modeId: 'edit',
                    targetObjectIds: ['clip-intro', 'clip-verse'],
                    dimensions: ['arrangement'],
                })
            )
        );

        const result = await parsePromptToActions({ prompt, context: createGlueProviderContext() });

        expect(result.actions).toEqual([{ type: 'setTempo', payload: { bpm: 130 } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
        expect(result.rejectionReason).toBeUndefined();
    });

    it('rejects the whole mixed provider plan when the prompt contains multiple glue commands', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [
                    { name: 'glueClips', arguments: { clipIds: ['clip-intro', 'clip-verse'] } },
                    { name: 'setTempo', arguments: { bpm: 130 } },
                ],
                nonAcousticMetricIntakeTurn({
                    modeId: 'edit',
                    targetObjectIds: ['clip-intro', 'clip-verse'],
                    dimensions: ['arrangement'],
                })
            )
        );

        const result = await parsePromptToActions({
            prompt: 'glue Intro and Verse clips, then glue Verse and Outro clips, then set tempo to 130',
            context: createGlueProviderContext(),
        });

        expect(result.actions).toEqual([]);
        expect(result.requiresConfirmation).toBe(false);
        expect(result.rejectionReason).toBe(
            'Provider action rejected: <batch>: Glue request must contain exactly one unambiguous direct clip pair or selected-clips command'
        );
    });

    it('proposes a grounded whole-clip MIDI transform as one confirmable atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const providerContext: ProjectContext = {
            ...baseContext,
            tracks: [
                {
                    id: 'track-piano',
                    name: 'Piano',
                    kind: 'midi',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 1,
                    deviceCount: 0,
                    clips: [
                        {
                            id: 'clip-piano-midi',
                            name: 'Piano MIDI',
                            type: 'midi',
                            startBeat: 0,
                            endBeat: 8,
                            noteCount: 4,
                        },
                    ],
                    devices: [],
                    sends: [],
                },
            ],
            selectedTrackId: 'track-piano',
            selectedClipId: 'clip-piano-midi',
            selectedClipIds: ['clip-piano-midi'],
        };
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [{ name: 'quantizeNoteLengths', arguments: { clipId: 'clip-piano-midi', gridSize: 0.25 } }],
                nonAcousticMetricIntakeTurn({
                    modeId: 'edit',
                    targetObjectIds: ['clip-piano-midi'],
                    dimensions: ['midi-content'],
                })
            )
        );

        const result = await parsePromptToActions({
            prompt: 'quantize note lengths in Piano MIDI to a 0.25 beat grid',
            context: providerContext,
        });

        expect(result.actions).toEqual([
            { type: 'quantizeNoteLengths', payload: { clipId: 'clip-piano-midi', gridSize: 0.25 } },
        ]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('rejects provider MIDI transforms for audio, locked, empty, or missing selected clips', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [{ name: 'setAllVelocities', arguments: { clipId: 'clip-selected', velocity: 96 } }],
                literalMetricIntakeTurn
            )
        );
        const baseClip = {
            id: 'clip-selected',
            name: 'Selected Clip',
            type: 'midi' as const,
            startBeat: 0,
            endBeat: 8,
            noteCount: 4,
        };
        const baseTrack = {
            id: 'track-selected',
            name: 'Selected Track',
            kind: 'midi' as const,
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read' as const,
            outputId: 'master',
            clipCount: 1,
            deviceCount: 0,
            devices: [],
            sends: [],
        };
        const contexts: ProjectContext[] = [
            { ...baseContext, tracks: [{ ...baseTrack, clips: [{ ...baseClip, type: 'audio' as const }] }] },
            { ...baseContext, tracks: [{ ...baseTrack, clips: [{ ...baseClip, locked: true }] }] },
            { ...baseContext, tracks: [{ ...baseTrack, clips: [{ ...baseClip, noteCount: 0 }] }] },
            { ...baseContext, tracks: [{ ...baseTrack, clipCount: 0, clips: [] }] },
        ].map((context) => ({
            ...context,
            selectedTrackId: baseTrack.id,
            selectedClipId: baseClip.id,
            selectedClipIds: [baseClip.id],
        }));

        for (const context of contexts) {
            const result = await parsePromptToActions({
                prompt: 'set all velocities in Selected Clip to 96',
                context,
            });

            expect(result.actions).toEqual([]);
            expect(result.rejectionReason).toContain('not grounded');
        }
    });

    it('proposes a grounded provider arm command as one confirmable atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const providerContext: ProjectContext = {
            ...baseContext,
            tracks: [
                {
                    id: 'track-vocals',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 0,
                    deviceCount: 0,
                    clips: [],
                    devices: [],
                    sends: [],
                },
            ],
            selectedTrackId: 'track-vocals',
        };
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [{ name: 'armTrack', arguments: { trackId: 'track-vocals', armed: true } }],
                literalMetricIntakeTurn
            )
        );

        const result = await parsePromptToActions({ prompt: 'arm Vocals for recording', context: providerContext });

        expect(result.actions).toEqual([{ type: 'armTrack', payload: { trackId: 'track-vocals', armed: true } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes a provider bus creation as one bounded atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'createBus', arguments: { name: 'Parallel Reverb' } }], literalMetricIntakeTurn)
        );

        const result = await parsePromptToActions({
            prompt: 'create a bus called Parallel Reverb',
            context: baseContext,
        });

        expect(result.actions).toEqual([{ type: 'createBus', payload: { name: 'Parallel Reverb' } }]);
        expect(result.requiresConfirmation).toBe(false);
        expect(result.executionMode).toBe('atomic');
    });

    it('materializes one stable bus identity across a dependent provider action batch', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const vocals = {
            id: 'track-vocals',
            name: 'Vocals',
            kind: 'audio',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read' as const,
            outputId: 'master',
            clipCount: 0,
            deviceCount: 0,
            clips: [],
            devices: [],
            sends: [],
        };
        const providerContext: ProjectContext = {
            ...baseContext,
            availableDeviceTypes: [{ id: 'builtin-reverb', name: 'Reverb' }],
            tracks: [vocals],
            selectedTrackId: vocals.id,
        };
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [
                    { name: 'createBus', arguments: { name: 'Vocal Plate', binding: 'vocal-plate' } },
                    { name: 'addDevice', arguments: { trackId: '$vocal-plate', deviceType: 'Reverb' } },
                    {
                        name: 'addSend',
                        arguments: { trackId: vocals.id, busId: '$vocal-plate', level: 0.25 },
                    },
                ],
                literalMetricIntakeTurn
            )
        );

        const result = await parsePromptToActions({
            prompt: 'create a bus called Vocal Plate, add Reverb to it, and send Vocals to it at 25%',
            context: providerContext,
        });

        const createBus = result.actions[0];
        const addDevice = result.actions[1];
        const addSend = result.actions[2];
        if (createBus?.type !== 'createBus' || addDevice?.type !== 'addDevice' || addSend?.type !== 'addSend') {
            throw new Error('Expected one materialized compound bus batch');
        }
        expect(createBus.payload.busId).toMatch(/^bus-ai-/u);
        expect(addDevice.payload.trackId).toBe(createBus.payload.busId);
        expect(addSend.payload.busId).toBe(createBus.payload.busId);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes grounded provider track deletion as one confirmable atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const providerContext: ProjectContext = {
            ...baseContext,
            tracks: [
                {
                    id: 'track-vocals',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    soloSafe: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 0,
                    deviceCount: 0,
                    clips: [],
                    devices: [],
                    sends: [],
                },
            ],
            selectedTrackId: 'track-vocals',
        };
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'removeTrack', arguments: { trackId: 'track-vocals' } }], literalMetricIntakeTurn)
        );

        const result = await parsePromptToActions({ prompt: 'delete the Vocals track', context: providerContext });

        expect(result.actions).toEqual([{ type: 'removeTrack', payload: { trackId: 'track-vocals' } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('rejects provider planning before adapter start when relevant locks exceed the authority cap', async () => {
        const lockedContext: ProjectContext = {
            ...baseContext,
            selectedTrackId: 'track-1',
            productionBrief: {
                schemaVersion: 1,
                id: 'brief-1',
                revision: 1,
                vision: 'Preserve the selected production authority.',
                references: [],
                hardConstraints: [],
                preferences: [],
                sectionGoals: [],
                trackRoles: [],
                locks: Array.from({ length: 65 }, (_, index) => ({
                    id: `lock-${index}`,
                    scope: { kind: 'track' as const, trackId: 'track-1' },
                    statement: `Keep selected track invariant ${index}.`,
                    createdAt: index,
                })),
                decisions: [],
                unresolvedQuestions: [],
                sourceRunLinks: [],
                supersedesBriefId: null,
                supersededByBriefId: null,
                createdAt: 1,
                updatedAt: 1,
            },
        };
        vi.mocked(generateToolCalls).mockResolvedValue(completePlan([], undefined));

        const result = await parsePromptToActions({
            prompt: 'make the selected track warmer',
            context: lockedContext,
        });

        expect(generateToolCalls).not.toHaveBeenCalled();
        expect(result).toMatchObject({ actions: [], requiresConfirmation: false });
        expect(result.rejectionReason).toContain('authority');
    });

    it('rejects a provider time signature that does not match the prompt', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [{ name: 'setTimeSignature', arguments: { numerator: 4, denominator: 4 } }],
                literalMetricIntakeTurn
            )
        );

        const result = await parsePromptToActions({ prompt: 'set time signature to 7/8', context: baseContext });

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('does not match the user request');
    });

    it('requires confirmation for a grounded multi-action provider plan', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const providerContext = createMixerContext();
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [
                    { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                    { name: 'setTrackGain', arguments: { trackId: 'track-guitar', gain: 0.6 } },
                ],
                unsupportedPerceptualIntake({
                    targetObjectIds: ['track-vocals', 'track-guitar'],
                    dimensions: ['processing'],
                })
            )
        );

        // Parsing keeps the proposal visible; the unsupported goal blocks approval without genuine metric proof.
        // This case asserts planning only.
        const result = await parsePromptToActions({
            prompt: 'mute Vocals and lower Guitar',
            context: providerContext,
        });

        expect(result.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true, expectedMuted: false } },
            {
                type: 'setTrackGain',
                payload: {
                    trackId: 'track-guitar',
                    gain: 0.6,
                    expectedGain: 0.8,
                    automationRecordingPolicy: 'suppressed',
                },
            },
        ]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    // #2350 gap 1: `llmActionBridge`'s own `setTrackGain`/`setMasterGain` range
    // checks sit upstream of `validateActionPayload` in this pipeline
    // (bridgeGroundedLlmToolCalls -> bridged.actions -> validateActions ->
    // PAYLOAD_VALIDATORS). Raising the validator's ceiling to `FADER_MAX_GAIN`
    // means nothing if the bridge itself still rejects above unity first. 1.5
    // sits strictly between the old `1` cap and `FADER_MAX_GAIN` (≈1.9953), so
    // it is a decisive probe: it only survives once both gates share the same
    // ceiling.
    it('lets a tool-call-sourced setTrackGain above unity reach the validator', async () => {
        expect(1.5).toBeLessThan(FADER_MAX_GAIN);
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const providerContext = createMixerContext();
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [{ name: 'setTrackGain', arguments: { trackId: 'track-guitar', gain: 1.5 } }],
                literalMetricIntakeTurn
            )
        );

        const result = await parsePromptToActions({ prompt: 'raise Guitar gain to 150%', context: providerContext });

        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toEqual([
            {
                type: 'setTrackGain',
                payload: {
                    trackId: 'track-guitar',
                    gain: 1.5,
                    expectedGain: 0.8,
                    automationRecordingPolicy: 'suppressed',
                },
            },
        ]);
    });

    it('lets a tool-call-sourced setMasterGain above unity reach the validator', async () => {
        expect(1.5).toBeLessThan(FADER_MAX_GAIN);
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setMasterGain', arguments: { gain: 1.5 } }], literalMetricIntakeTurn)
        );

        const result = await parsePromptToActions({ prompt: 'set master gain to 1.5', context: baseContext });

        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toEqual([{ type: 'setMasterGain', payload: { gain: 1.5 } }]);
    });

    it('does not partially accept a provider batch containing a rejected call', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [
                    { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                    { name: 'setTempo', arguments: { bpm: 128 } },
                ],
                literalMetricIntakeTurn
            )
        );
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [{ type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } }],
            rejections: [{ index: 1, name: 'setTempo', reason: 'Action is not grounded in the request' }],
        });

        const result = await parsePromptToActions({
            prompt: 'mute the vocals and save the project',
            context: baseContext,
        });

        expect(result.actions).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            '[AI] Rejected tool call 1 (setTempo): Action is not grounded in the request'
        );
    });

    it('rejects a provider tool that was not advertised before bridge grounding', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(
            scriptedPlan(literalMetricIntakeTurn, [
                { status: 'complete', toolCalls: [{ name: 'saveProject', arguments: {} }] },
            ])
        );
        const result = await parsePromptToActions({ prompt: 'save the project', context: baseContext });

        expect(result).toEqual({
            actions: [],
            rawText: 'save the project',
            applicationToolReceipts: expect.arrayContaining([
                expect.objectContaining({ toolName: 'selectCreativeInterpretation', status: 'success' }),
            ]),
            requiresConfirmation: false,
            rejectionReason: 'Provider planning rejected: Provider requested an unavailable application tool.',
            planningOutcome: {
                kind: 'denied',
                reason: 'Provider planning rejected: Provider requested an unavailable application tool.',
            },
        });
        expect(mockBridgeGroundedLlmToolCalls).not.toHaveBeenCalled();
    });

    it('returns a rejection when runtime validation filters a provider batch', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setTempo', arguments: { bpm: 128 } }], literalMetricIntakeTurn)
        );
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [{ type: 'saveProject' }],
            rejections: [],
        });

        const result = await parsePromptToActions({ prompt: 'set tempo to 128', context: baseContext });

        expect(result).toMatchObject({
            actions: [],
            rawText: 'set tempo to 128',
            requiresConfirmation: false,
            rejectionReason: 'Provider action failed runtime validation: saveProject',
        });
        expect(result.applicationToolReceipts).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ toolName: 'selectCreativeInterpretation', status: 'success' }),
                expect.objectContaining({ toolName: 'agent.catalog.discover', status: 'success' }),
            ])
        );
    });

    it('returns a rejected provider planning outcome without bridging it', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue({
            status: 'rejected',
            reason: 'Provider text tool planning did not complete (finish_reason: length)',
        });

        const result = await parsePromptToActions({ prompt: 'mute the vocals', context: baseContext });

        expect(result).toEqual({
            actions: [],
            rawText: 'mute the vocals',
            requiresConfirmation: false,
            rejectionReason:
                'Provider planning rejected: Provider text tool planning did not complete (finish_reason: length)',
            planningOutcome: {
                kind: 'denied',
                reason: 'Provider planning rejected: Provider text tool planning did not complete (finish_reason: length)',
            },
        });
        expect(mockBridgeGroundedLlmToolCalls).not.toHaveBeenCalled();
    });

    it.each([
        'Provider refused tool planning',
        'Provider returned an invalid tool plan',
        'Provider returned an incomplete tool plan',
    ])('returns provider planning failure %s without producing actions', async (reason) => {
        vi.mocked(generateToolCalls).mockRejectedValue(new Error(reason));

        const result = await parsePromptToActions({ prompt: 'mute the vocals', context: baseContext });

        expect(result).toEqual({
            actions: [],
            rawText: 'mute the vocals',
            requiresConfirmation: false,
            rejectionReason: `Provider planning failed: ${reason}`,
            planningOutcome: { kind: 'denied', reason: `Provider planning failed: ${reason}` },
        });
    });

    it.each(['set tempo to 128', 'create a send from vocals to reverb'])(
        'returns no actions for %s after an empty provider plan',
        async (prompt) => {
            vi.mocked(generateToolCalls).mockResolvedValue(completePlan([], literalMetricIntakeTurn));
            mockBridgeGroundedLlmToolCalls.mockReturnValue({ actions: [], rejections: [] });

            const result = await parsePromptToActions({ prompt, context: baseContext });

            expect(result).toEqual({
                actions: [],
                rawText: prompt,
                applicationToolReceipts: expect.arrayContaining([
                    expect.objectContaining({ toolName: 'selectCreativeInterpretation', status: 'success' }),
                ]),
                requiresConfirmation: false,
                planningOutcome: { kind: 'no-match' },
            });
        }
    );

    it('preserves configuration-change cancellation instead of reporting no actions', async () => {
        vi.mocked(generateToolCalls).mockRejectedValue(new AiRuntimeConfigurationChangedError());

        await expect(parsePromptToActions({ prompt: 'mute the vocals', context: baseContext })).rejects.toMatchObject({
            name: 'AiRuntimeConfigurationChangedError',
        });

        expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('Provider tool planning failed'));
    });

    it('returns multiple valid provider actions as one complete batch proposal', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan(
                [
                    { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                    { name: 'setTrackPan', arguments: { trackId: 'track-guitar', pan: -20 } },
                ],
                literalMetricIntakeTurn
            )
        );
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [
                { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } },
                { type: 'setTrackPan', payload: { trackId: 'track-guitar', pan: -20 } },
            ],
            rejections: [],
        });

        const result = await parsePromptToActions({
            prompt: 'mute vocals and pan guitar left',
            context: createMixerContext(),
        });

        expect(result.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true, expectedMuted: false } },
            {
                type: 'setTrackPan',
                payload: { trackId: 'track-guitar', pan: -20, expectedPan: 0, automationRecordingPolicy: 'suppressed' },
            },
        ]);
        expect(result.executionMode).toBe('atomic');
    });
});
