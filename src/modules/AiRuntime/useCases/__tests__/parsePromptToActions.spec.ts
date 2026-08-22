import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { AiRuntimeConfigurationChangedError } from '../../errors/AiRuntimeConfigurationChangedError';
import { type ProjectContext } from '../../models/ProjectContext';
import { tryPresetMatch, tryParameterizedPath, tryCompoundFastPath } from '../../transformers/promptParser/parsing';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome as generateToolCalls } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';

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

type CompletePlanOutcome = {
    status: 'complete';
    toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
};

function completePlan<TToolCall extends { name: string; arguments: Record<string, unknown> }>(
    toolCalls: TToolCall[]
): CompletePlanOutcome {
    const workflowCalls = toolCalls.filter((call) => call.name === 'selectWorkflowCapability');
    const commandCalls = toolCalls.filter((call) => call.name !== 'selectWorkflowCapability');
    if (commandCalls.length === 0) {
        return { status: 'complete', toolCalls: workflowCalls };
    }
    const commandNames = [...new Set(commandCalls.map((call) => call.name))];
    let providerTurn = 0;
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
    // Each planning run has a bounded discovery turn followed by its proposal turn.
    return {
        then(resolve: (outcome: CompletePlanOutcome) => unknown) {
            providerTurn = providerTurn === 0 ? 1 : 0;
            return Promise.resolve(resolve(providerTurn === 1 ? catalogPlan : proposalPlan));
        },
    } as unknown as CompletePlanOutcome;
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
        vi.restoreAllMocks();
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

        const result = await parsePromptToActions(prompt, baseContext);

        expect(result.actions).toEqual([action]);
        expect(result.requiresConfirmation).toBe(true);
    });

    it('requires confirmation for a multi-action compound fast path', async () => {
        const actions = [
            { type: 'muteTrack' as const, payload: { trackId: 'track-vocals', muted: true } },
            { type: 'setTrackGain' as const, payload: { trackId: 'track-guitar', gain: 0.6 } },
        ];
        vi.mocked(tryCompoundFastPath).mockReturnValue(actions);

        const result = await parsePromptToActions('mute vocals and lower guitar', createMixerContext());

        expect(result.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true, expectedMuted: false } },
            { type: 'setTrackGain', payload: { trackId: 'track-guitar', gain: 0.6, expectedGain: 0.8 } },
        ]);
        expect(result.requiresConfirmation).toBe(true);
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
        vi.mocked(generateToolCalls)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'catalog-mute-track',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', names: ['muteTrack'] },
                    },
                ],
            })
            .mockResolvedValueOnce({
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
                                    targetIds: ['track-vocals', 'track-guitar'],
                                    targetRanges: [],
                                    protectedTargetIds: [],
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
            });

        const result = await parsePromptToActions(prompt, createMixerContext(), undefined, 'revision-1');

        expect(generateToolCalls).toHaveBeenCalledTimes(2);
        expect(result.actions).toEqual(expectedActions);
        if (expectedActions.length === 0) {
            expect(result.rejectionReason).toBeDefined();
            return;
        }
        expect(result.rejectionReason).toBeUndefined();
        expect(result.requiresConfirmation).toBe(true);
    });

    it('rejects a fast-path plan before confirmation when it conflicts with locked production intent', async () => {
        vi.mocked(tryParameterizedPath).mockReturnValue([{ type: 'setTempo', payload: { bpm: 128 } }]);
        mockDoesProductionBriefAllowActionBatch.mockReturnValue(false);

        const result = await parsePromptToActions('set tempo to 128', baseContext);

        expect(mockDoesProductionBriefAllowActionBatch).toHaveBeenCalledWith([
            { type: 'setTempo', payload: { bpm: 128 } },
        ]);
        expect(result).toEqual({
            actions: [],
            rawText: 'set tempo to 128',
            requiresConfirmation: false,
            rejectionReason: 'Recognized command conflicts with locked production intent.',
        });
    });

    it('should return empty intent when signal is aborted before LLM path', async () => {
        const controller = new AbortController();
        controller.abort();

        const result = await parsePromptToActions('anything', baseContext, controller.signal);

        expect(result).toEqual({
            actions: [],
            rawText: 'anything',
            requiresConfirmation: false,
        });
    });

    it.each([
        { prompt: 'save project', actionType: 'saveProject' },
        { prompt: 'new project', actionType: 'newProject' },
        { prompt: 'export', actionType: 'exportProject' },
        { prompt: 'import audio', actionType: 'importAudioFile' },
        { prompt: 'import midi', actionType: 'importMidiFile' },
        { prompt: 'leave session', actionType: 'leaveCollabSession' },
    ] as const)('recognizes denied intent $prompt without provider planning', async ({ prompt, actionType }) => {
        const result = await parsePromptToActions(prompt, baseContext);

        expect(result).toEqual({
            actions: [],
            rawText: prompt,
            requiresConfirmation: false,
            rejectionReason: `Action ${actionType} cannot be executed by AI because it does not report completion.`,
        });
        expect(generateToolCalls).not.toHaveBeenCalled();
    });

    it('turns provider tool calls into validated proposals against the frozen planning context', async () => {
        const currentContext = { ...baseContext, tempo: 121 };
        vi.mocked(getProjectContext).mockReturnValue(currentContext);
        vi.mocked(generateToolCalls).mockResolvedValue(completePlan([{ name: 'setTempo', arguments: { bpm: 128 } }]));
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [{ type: 'setTempo', payload: { bpm: 128 } }],
            rejections: [],
        });

        const result = await parsePromptToActions('make the project faster', baseContext);

        const firstProviderCall = vi.mocked(generateToolCalls).mock.calls[0];
        expect(firstProviderCall?.[0]).toContain('command system prompt');
        expect(firstProviderCall?.[1]).toContain('fixed_policy:');
        expect(firstProviderCall?.[2]).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    function: expect.objectContaining({ name: 'selectWorkflowCapability' }),
                }),
                expect.objectContaining({
                    function: expect.objectContaining({ name: 'agent.catalog.discover' }),
                }),
            ])
        );
        expect(firstProviderCall?.[4]).toBe('make the project faster');
        expect(mockBridgeGroundedLlmToolCalls).toHaveBeenCalledWith({
            calls: [{ name: 'setTempo', arguments: { bpm: 128 } }],
            context: baseContext,
            markerSignatures: [],
            sectionSignatures: [],
            prompt: 'make the project faster',
        });
        expect(result.actions).toEqual([{ type: 'setTempo', payload: { bpm: 128 } }]);
        expect(result.executionMode).toBe('atomic');
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
        vi.mocked(generateToolCalls).mockResolvedValue(completePlan([{ name: 'setTempo', arguments: { bpm: 128 } }]));
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [{ type: 'setTempo', payload: { bpm: 128 } }],
            rejections: [],
        });

        await parsePromptToActions(
            'Mute vocals.',
            baseContext,
            undefined,
            'revision-resume',
            undefined,
            undefined,
            { runId: 'resumed-planning-attempt', requestId: 'request-resume', cancellationGeneration: 0 },
            () => ({ status: 'admitted' })
        );

        const firstProviderCall = vi.mocked(generateToolCalls).mock.calls[0];
        expect(firstProviderCall?.[0]).toContain('Mute vocals only');
        expect(firstProviderCall?.[0]).toContain('source-decision');
        expect(firstProviderCall?.[1]).toContain('Mute vocals only');
    });

    it('rejects a provider plan before confirmation when it conflicts with locked production intent', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(completePlan([{ name: 'setTempo', arguments: { bpm: 128 } }]));
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [{ type: 'setTempo', payload: { bpm: 128 } }],
            rejections: [],
        });
        mockDoesProductionBriefAllowActionBatch.mockReturnValue(false);

        const result = await parsePromptToActions('make the project faster', baseContext);

        expect(mockDoesProductionBriefAllowActionBatch).toHaveBeenCalledWith([
            { type: 'setTempo', payload: { bpm: 128 } },
        ]);
        expect(result).toMatchObject({
            actions: [],
            rawText: 'make the project faster',
            requiresConfirmation: false,
            rejectionReason: 'Provider action conflicts with locked production intent.',
        });
        expect(result.applicationToolReceipts).toMatchObject([
            { toolName: 'agent.catalog.discover', status: 'success' },
        ]);
    });

    it('proposes an explicit provider time-signature command as one confirmable atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }])
        );

        const result = await parsePromptToActions('set time signature to 7/8', baseContext);

        expect(result.actions).toEqual([{ type: 'setTimeSignature', payload: { numerator: 7, denominator: 8 } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes an explicit provider stop command even when visible playback is already stopped', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(completePlan([{ name: 'stopPlayback', arguments: {} }]));

        const result = await parsePromptToActions('please stop the transport', {
            ...baseContext,
            isPlaying: false,
            isRecording: false,
        });

        expect(result.actions).toEqual([{ type: 'stopPlayback' }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes an explicit provider playhead seek as one confirmable atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'seekPlayhead', arguments: { beat: 8.5 } }])
        );

        const result = await parsePromptToActions('seek the playhead to beat 8.5', baseContext);

        expect(result.actions).toEqual([{ type: 'seekPlayhead', payload: { beat: 8.5 } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('routes one explicit clip loop-length request through the provider-neutral grounded path', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setClipLoopLength', arguments: { clipId: 'clip-intro', loopLength: 4 } }])
        );
        const providerContext = createGlueProviderContext();

        const result = await parsePromptToActions('set the Intro clip loop length to 4 beats', {
            ...providerContext,
            selectedClipId: 'clip-intro',
            selectedClipIds: ['clip-intro'],
        });

        expect(result.actions).toEqual([
            { type: 'setClipLoopLength', payload: { clipId: 'clip-intro', loopLength: 4 } },
        ]);
        expect(result.requiresConfirmation).toBe(false);
        expect(result.executionMode).toBe('atomic');
    });

    it('routes one explicit punch endpoint through the provider-neutral grounded action path', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(completePlan([{ name: 'setPunchIn', arguments: { beat: 20 } }]));

        const result = await parsePromptToActions('set punch in at beat 20', baseContext);

        expect(result.actions).toEqual([{ type: 'setPunchIn', payload: { beat: 20 } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('routes explicit punch enablement through the provider-neutral grounded action path', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setPunchEnabled', arguments: { enabled: true } }])
        );

        const result = await parsePromptToActions('enable punch in/out', {
            ...baseContext,
            punchInEnabled: false,
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
                    function: expect.objectContaining({ name: 'selectWorkflowCapability' }),
                }),
                expect.objectContaining({
                    function: expect.objectContaining({ name: 'agent.catalog.discover' }),
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
            completePlan([{ name: 'setPunchEnabled', arguments: { enabled: true } }])
        );

        await parsePromptToActions('enable punch in/out', baseContext, undefined, 'revision-2', undefined, undefined, {
            runId: 'run-with-failures',
            requestId: 'request-1',
            cancellationGeneration: 0,
        });

        const message = vi.mocked(generateToolCalls).mock.calls[0]?.[1];
        expect(message).toContain('failure-23');
        expect(message).not.toContain('failure-0');
        expect(message).toContain('"omitted":8');
    });

    it('proposes a grounded provider marker as one reversible atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'addMarker', arguments: { beat: 16, name: 'Chorus' } }])
        );

        const result = await parsePromptToActions('add a marker at beat 16 named Chorus', baseContext);

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
            completePlan([{ name: 'addMarker', arguments: { beat: 16, name: 'Chorus' } }])
        );

        const prompt = 'add a marker at beat 16 named Chorus';
        const result = await parsePromptToActions(prompt, baseContext);

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
            completePlan([{ name: 'removeMarker', arguments: { beat: 16, name: 'Chorus' } }])
        );

        const result = await parsePromptToActions('delete marker Chorus at beat 16', baseContext);

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
            completePlan([{ name: 'setMarkerColor', arguments: { beat: 16, name: 'Chorus', color: 'amber' } }])
        );

        const prompt = 'set marker color for Chorus at beat 16 to amber';
        const result = await parsePromptToActions(prompt, baseContext);

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
            completePlan([{ name: 'removeSection', arguments: { startBeat: 8, endBeat: 16, name: 'Verse' } }])
        );

        const prompt = 'remove the section named Verse from beat 8 to beat 16';
        const result = await parsePromptToActions(prompt, baseContext);

        expect(result.actions).toEqual([{ type: 'removeSection', payload: { sectionId: 'section-internal' } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(vi.mocked(generateToolCalls).mock.calls[0]?.[1]).not.toContain('section-internal');
    });

    it('proposes grounded non-destructive clip normalization as one atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'normalizeClip', arguments: { clipId: 'clip-intro', mode: 'lufs', targetDb: -14 } }])
        );
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

        const result = await parsePromptToActions('normalize the Intro clip to -14 LUFS', providerContext);

        expect(result.actions).toEqual([
            { type: 'normalizeClip', payload: { clipId: 'clip-intro', mode: 'lufs', targetDb: -14 } },
        ]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes grounded non-destructive clip stretch controls as atomic actions', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const plans = [
            completePlan([{ name: 'setClipStretchRatio', arguments: { clipId: 'clip-intro', ratio: 1.5 } }]),
            completePlan([{ name: 'setClipStretchMode', arguments: { clipId: 'clip-intro', mode: 'timestretch' } }]),
            completePlan([{ name: 'fitClipToBeats', arguments: { clipId: 'clip-intro', targetBeats: 4 } }]),
        ];
        let planIndex = 0;
        vi.mocked(generateToolCalls).mockImplementation(async () => {
            const plan = plans[Math.floor(planIndex / 2)];
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

        const result = await parsePromptToActions('set the Intro clip stretch ratio to 1.5', providerContext);
        const modeResult = await parsePromptToActions(
            'set the Intro clip stretch mode to timestretch',
            providerContext
        );
        const fitResult = await parsePromptToActions('fit the Intro clip duration to 4 beats', providerContext);

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
            completePlan([
                {
                    name: 'moveClip',
                    arguments: { clipId: 'clip-intro', trackId: 'track-guitar', startBeat: 16 },
                },
            ])
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

        const result = await parsePromptToActions('move the Intro clip to Guitar at beat 16', providerContext);

        expect(result.actions).toEqual([
            { type: 'moveClip', payload: { clipId: 'clip-intro', trackId: 'track-guitar', startBeat: 16 } },
        ]);
        expect(result.requiresConfirmation).toBe(false);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes a grounded two-clip crossfade as one confirmable atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'crossfadeClips', arguments: { clipAId: 'clip-intro', clipBId: 'clip-chorus' } }])
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

        const result = await parsePromptToActions('crossfade Intro into Chorus', providerContext);

        expect(result.actions).toEqual([
            { type: 'crossfadeClips', payload: { clipAId: 'clip-intro', clipBId: 'clip-chorus' } },
        ]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes grounded MIDI clip glue as one destructive confirmable atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'glueClips', arguments: { clipIds: ['clip-intro', 'clip-verse'] } }])
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

        const result = await parsePromptToActions('glue the Intro and Verse clips', providerContext);

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
            completePlan([
                { name: 'glueClips', arguments: { clipIds: ['clip-intro', 'clip-verse'] } },
                { name: 'setTempo', arguments: { bpm: 130 } },
            ])
        );

        const result = await parsePromptToActions(prompt, createGlueProviderContext());

        expect(result.actions).toEqual([{ type: 'setTempo', payload: { bpm: 130 } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
        expect(result.rejectionReason).toBeUndefined();
    });

    it('rejects the whole mixed provider plan when the prompt contains multiple glue commands', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([
                { name: 'glueClips', arguments: { clipIds: ['clip-intro', 'clip-verse'] } },
                { name: 'setTempo', arguments: { bpm: 130 } },
            ])
        );

        const result = await parsePromptToActions(
            'glue Intro and Verse clips, then glue Verse and Outro clips, then set tempo to 130',
            createGlueProviderContext()
        );

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
            completePlan([{ name: 'quantizeNoteLengths', arguments: { clipId: 'clip-piano-midi', gridSize: 0.25 } }])
        );

        const result = await parsePromptToActions(
            'quantize note lengths in Piano MIDI to a 0.25 beat grid',
            providerContext
        );

        expect(result.actions).toEqual([
            { type: 'quantizeNoteLengths', payload: { clipId: 'clip-piano-midi', gridSize: 0.25 } },
        ]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('rejects provider MIDI transforms for audio, locked, empty, or missing selected clips', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setAllVelocities', arguments: { clipId: 'clip-selected', velocity: 96 } }])
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
            const result = await parsePromptToActions('set all velocities in Selected Clip to 96', context);

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
            completePlan([{ name: 'armTrack', arguments: { trackId: 'track-vocals', armed: true } }])
        );

        const result = await parsePromptToActions('arm Vocals for recording', providerContext);

        expect(result.actions).toEqual([{ type: 'armTrack', payload: { trackId: 'track-vocals', armed: true } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes a provider bus creation as one bounded atomic action', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'createBus', arguments: { name: 'Parallel Reverb' } }])
        );

        const result = await parsePromptToActions('create a bus called Parallel Reverb', baseContext);

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
            completePlan([
                { name: 'createBus', arguments: { name: 'Vocal Plate', binding: 'vocal-plate' } },
                { name: 'addDevice', arguments: { trackId: '$vocal-plate', deviceType: 'Reverb' } },
                {
                    name: 'addSend',
                    arguments: { trackId: vocals.id, busId: '$vocal-plate', level: 0.25 },
                },
            ])
        );

        const result = await parsePromptToActions(
            'create a bus called Vocal Plate, add Reverb to it, and send Vocals to it at 25%',
            providerContext
        );

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
            completePlan([{ name: 'removeTrack', arguments: { trackId: 'track-vocals' } }])
        );

        const result = await parsePromptToActions('delete the Vocals track', providerContext);

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
        vi.mocked(generateToolCalls).mockResolvedValue(completePlan([]));

        const result = await parsePromptToActions('make the selected track warmer', lockedContext);

        expect(generateToolCalls).not.toHaveBeenCalled();
        expect(result).toMatchObject({ actions: [], requiresConfirmation: false });
        expect(result.rejectionReason).toContain('authority');
    });

    it('rejects a provider time signature that does not match the prompt', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setTimeSignature', arguments: { numerator: 4, denominator: 4 } }])
        );

        const result = await parsePromptToActions('set time signature to 7/8', baseContext);

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('does not match the user request');
    });

    it('requires confirmation for a grounded multi-action provider plan', async () => {
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const providerContext = createMixerContext();
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([
                { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                { name: 'setTrackGain', arguments: { trackId: 'track-guitar', gain: 0.6 } },
            ])
        );

        const result = await parsePromptToActions('mute Vocals and lower Guitar', providerContext);

        expect(result.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true, expectedMuted: false } },
            { type: 'setTrackGain', payload: { trackId: 'track-guitar', gain: 0.6, expectedGain: 0.8 } },
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
            completePlan([{ name: 'setTrackGain', arguments: { trackId: 'track-guitar', gain: 1.5 } }])
        );

        const result = await parsePromptToActions('raise Guitar gain to 150%', providerContext);

        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toEqual([
            { type: 'setTrackGain', payload: { trackId: 'track-guitar', gain: 1.5, expectedGain: 0.8 } },
        ]);
    });

    it('lets a tool-call-sourced setMasterGain above unity reach the validator', async () => {
        expect(1.5).toBeLessThan(FADER_MAX_GAIN);
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setMasterGain', arguments: { gain: 1.5 } }])
        );

        const result = await parsePromptToActions('set master gain to 1.5', baseContext);

        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toEqual([{ type: 'setMasterGain', payload: { gain: 1.5 } }]);
    });

    it('does not partially accept a provider batch containing a rejected call', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([
                { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                { name: 'setTempo', arguments: { bpm: 128 } },
            ])
        );
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [{ type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } }],
            rejections: [{ index: 1, name: 'setTempo', reason: 'Action is not grounded in the request' }],
        });

        const result = await parsePromptToActions('mute the vocals and save the project', baseContext);

        expect(result.actions).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            '[AI] Rejected tool call 1 (setTempo): Action is not grounded in the request'
        );
    });

    it('rejects a provider tool that was not advertised before bridge grounding', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue({
            status: 'complete',
            toolCalls: [{ name: 'saveProject', arguments: {} }],
        });
        const result = await parsePromptToActions('save the project', baseContext);

        expect(result).toEqual({
            actions: [],
            rawText: 'save the project',
            requiresConfirmation: false,
            rejectionReason: 'Provider planning rejected: Provider requested an unavailable application tool.',
        });
        expect(mockBridgeGroundedLlmToolCalls).not.toHaveBeenCalled();
    });

    it('returns a rejection when runtime validation filters a provider batch', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(completePlan([{ name: 'setTempo', arguments: { bpm: 128 } }]));
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [{ type: 'saveProject' }],
            rejections: [],
        });

        const result = await parsePromptToActions('set tempo to 128', baseContext);

        expect(result).toMatchObject({
            actions: [],
            rawText: 'set tempo to 128',
            requiresConfirmation: false,
            rejectionReason: 'Provider action failed runtime validation: saveProject',
        });
        expect(result.applicationToolReceipts).toMatchObject([
            { toolName: 'agent.catalog.discover', status: 'success' },
        ]);
    });

    it('returns a rejected provider planning outcome without bridging it', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue({
            status: 'rejected',
            reason: 'Provider text tool planning did not complete (finish_reason: length)',
        });

        const result = await parsePromptToActions('mute the vocals', baseContext);

        expect(result).toEqual({
            actions: [],
            rawText: 'mute the vocals',
            requiresConfirmation: false,
            rejectionReason:
                'Provider planning rejected: Provider text tool planning did not complete (finish_reason: length)',
        });
        expect(mockBridgeGroundedLlmToolCalls).not.toHaveBeenCalled();
    });

    it.each([
        'Provider refused tool planning',
        'Provider returned an invalid tool plan',
        'Provider returned an incomplete tool plan',
    ])('returns provider planning failure %s without producing actions', async (reason) => {
        vi.mocked(generateToolCalls).mockRejectedValue(new Error(reason));

        const result = await parsePromptToActions('mute the vocals', baseContext);

        expect(result).toEqual({
            actions: [],
            rawText: 'mute the vocals',
            requiresConfirmation: false,
            rejectionReason: `Provider planning failed: ${reason}`,
        });
    });

    it.each(['set tempo to 128', 'create a send from vocals to reverb'])(
        'returns no actions for %s after an empty provider plan',
        async (prompt) => {
            vi.mocked(generateToolCalls).mockResolvedValue(completePlan([]));
            mockBridgeGroundedLlmToolCalls.mockReturnValue({ actions: [], rejections: [] });

            const result = await parsePromptToActions(prompt, baseContext);

            expect(result).toEqual({
                actions: [],
                rawText: prompt,
                requiresConfirmation: false,
            });
        }
    );

    it('preserves configuration-change cancellation instead of reporting no actions', async () => {
        vi.mocked(generateToolCalls).mockRejectedValue(new AiRuntimeConfigurationChangedError());

        await expect(parsePromptToActions('mute the vocals', baseContext)).rejects.toMatchObject({
            name: 'AiRuntimeConfigurationChangedError',
        });

        expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('Provider tool planning failed'));
    });

    it('returns multiple valid provider actions as one complete batch proposal', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([
                { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                { name: 'setTrackPan', arguments: { trackId: 'track-guitar', pan: -20 } },
            ])
        );
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [
                { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } },
                { type: 'setTrackPan', payload: { trackId: 'track-guitar', pan: -20 } },
            ],
            rejections: [],
        });

        const result = await parsePromptToActions('mute vocals and pan guitar left', createMixerContext());

        expect(result.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true, expectedMuted: false } },
            { type: 'setTrackPan', payload: { trackId: 'track-guitar', pan: -20, expectedPan: 0 } },
        ]);
        expect(result.executionMode).toBe('atomic');
    });
});
