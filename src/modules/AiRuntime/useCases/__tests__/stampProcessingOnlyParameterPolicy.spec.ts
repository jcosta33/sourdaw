import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { getExecutableAppActionToolSchemas, parseVersionedCommandEnvelope } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { materializeActionStateGuards } from '../materializeActionStateGuards';
import { parsePromptToActions } from '../parsePromptToActions';
import { stampProcessingOnlyParameterPolicy } from '../stampProcessingOnlyParameterPolicy';

vi.mock('../llmOrchestration/inference', async (importOriginal) => {
    const original = await importOriginal<typeof import('../llmOrchestration/inference')>();
    return {
        ...original,
        generateToolPlanningOutcome: vi.fn(original.generateToolPlanningOutcome),
    };
});

const mixParameter = {
    id: 'mix',
    name: 'Mix',
    type: 'float' as const,
    value: 0.5,
    minValue: 0,
    maxValue: 1,
    unit: '',
};

function createTrack(): ProjectContextTrack {
    return {
        id: 'track-vocals',
        name: 'Vocals',
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        frozen: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        outputId: 'master',
        clipCount: 0,
        deviceCount: 1,
        clips: [],
        devices: [
            {
                id: 'device-reverb',
                name: 'Reverb',
                type: 'Reverb',
                bypassed: false,
                parameters: [{ ...mixParameter }],
            },
        ],
        sends: [],
    };
}

function createContext(): ProjectContext {
    return {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 16,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 16,
        metronomeEnabled: false,
        metronomeVolume: 0.5,
        masterGain: 1,
        activeView: 'arrange',
        playheadPosition: 0,
        selectedTrackId: 'track-vocals',
        selectedClipId: null,
        selectedClipIds: [],
        tracks: [createTrack()],
    };
}

const providerPlan = {
    semantic: { classification: 'simple', uncertainty: [] },
    objective: 'Set one reverb parameter on the named track.',
    constraints: [],
    scope: {
        targetIds: ['track-vocals', 'device-reverb', 'mix'],
        targetRanges: [],
        protectedTargetIds: [],
        protectedRanges: [],
    },
    capabilityIds: [],
    assetIds: [],
    alternatives: [],
    validationStrategy: [],
    stoppingConditions: [],
};

function materializeMixedBatch() {
    const result = materializeActionStateGuards(
        [
            { type: 'setTrackGain', payload: { trackId: 'track-vocals', gain: 0.5 } },
            { type: 'setTrackPan', payload: { trackId: 'track-vocals', pan: -25 } },
            {
                type: 'setDeviceParameter',
                payload: { deviceId: 'device-reverb', paramId: 'mix', value: 0.25, expectedTrackId: 'track-vocals' },
            },
            { type: 'setDeviceParameter', payload: { deviceId: 'device-reverb', paramId: 'mix', value: 0.75 } },
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } },
        ],
        createContext()
    );
    if (result.status !== 'accepted') {
        throw new Error(result.reason);
    }
    return result.actions;
}

describe('stampProcessingOnlyParameterPolicy', () => {
    it('stamps the processing-only policy on every parameter edit and leaves other actions untouched', () => {
        const muteTrack: AppAction = {
            type: 'muteTrack',
            payload: { trackId: 'track-vocals', muted: true, expectedMuted: false },
        };
        const addClip: AppAction = {
            type: 'addClip',
            payload: { trackId: 'track-vocals', startBeat: 0, endBeat: 4, name: 'Verse' },
        };
        const parameterEdits: AppAction[] = [
            { type: 'setTrackGain', payload: { trackId: 'track-vocals', gain: 0.5, expectedGain: 0.8 } },
            { type: 'setTrackPan', payload: { trackId: 'track-vocals', pan: -25, expectedPan: 0 } },
            { type: 'setDeviceParameter', payload: { deviceId: 'device-reverb', paramId: 'mix', value: 0.25 } },
        ];

        const stamped = stampProcessingOnlyParameterPolicy([...parameterEdits, muteTrack, addClip]);

        expect(stamped.slice(0, 3)).toEqual([
            {
                type: 'setTrackGain',
                payload: {
                    trackId: 'track-vocals',
                    gain: 0.5,
                    expectedGain: 0.8,
                    automationRecordingPolicy: 'suppressed',
                },
            },
            {
                type: 'setTrackPan',
                payload: {
                    trackId: 'track-vocals',
                    pan: -25,
                    expectedPan: 0,
                    automationRecordingPolicy: 'suppressed',
                },
            },
            {
                type: 'setDeviceParameter',
                payload: {
                    deviceId: 'device-reverb',
                    paramId: 'mix',
                    value: 0.25,
                    automationRecordingPolicy: 'suppressed',
                },
            },
        ]);
        expect(stamped[3]).toBe(muteTrack);
        expect(stamped[4]).toBe(addClip);
    });

    it('is idempotent: stamping an already-stamped batch changes nothing', () => {
        const actions: AppAction[] = [
            { type: 'setTrackGain', payload: { trackId: 'track-vocals', gain: 0.5, expectedGain: 0.8 } },
            { type: 'setTrackPan', payload: { trackId: 'track-vocals', pan: -25, expectedPan: 0 } },
            { type: 'setDeviceParameter', payload: { deviceId: 'device-reverb', paramId: 'mix', value: 0.25 } },
        ];
        const once = stampProcessingOnlyParameterPolicy(actions);

        const twice = stampProcessingOnlyParameterPolicy(once);

        expect(twice).toEqual(once);
        expect(twice[0]).toBe(once[0]);
        expect(twice[1]).toBe(once[1]);
        expect(twice[2]).toBe(once[2]);
    });
});

describe('materializeActionStateGuards processing-only chokepoint', () => {
    it('carries the policy on every materialized parameter edit and on no other action', () => {
        const actions = materializeMixedBatch();

        expect(actions).toEqual([
            {
                type: 'setTrackGain',
                payload: {
                    trackId: 'track-vocals',
                    gain: 0.5,
                    expectedGain: 0.8,
                    automationRecordingPolicy: 'suppressed',
                },
            },
            {
                type: 'setTrackPan',
                payload: {
                    trackId: 'track-vocals',
                    pan: -25,
                    expectedPan: 0,
                    automationRecordingPolicy: 'suppressed',
                },
            },
            {
                type: 'setDeviceParameter',
                payload: {
                    deviceId: 'device-reverb',
                    paramId: 'mix',
                    value: 0.25,
                    expectedTrackId: 'track-vocals',
                    expectedDeviceIds: ['device-reverb'],
                    automationRecordingPolicy: 'suppressed',
                },
            },
            {
                type: 'setDeviceParameter',
                payload: {
                    deviceId: 'device-reverb',
                    paramId: 'mix',
                    value: 0.75,
                    automationRecordingPolicy: 'suppressed',
                },
            },
            {
                type: 'muteTrack',
                payload: { trackId: 'track-vocals', muted: true, expectedMuted: false },
            },
        ]);
    });
});

describe('planner routes that reach the chokepoint', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        clearHandlerRegistry();
        vi.restoreAllMocks();
    });

    it('stamps a deterministic gain edit without consulting the provider', async () => {
        const result = await parsePromptToActions('set volume to 1', createContext());

        expect(result.actions).toEqual([
            {
                type: 'setTrackGain',
                payload: {
                    trackId: 'track-vocals',
                    gain: 1,
                    expectedGain: 0.8,
                    automationRecordingPolicy: 'suppressed',
                },
            },
        ]);
        expect(generateToolPlanningOutcome).not.toHaveBeenCalled();
    });

    it('stamps a provider-proposed device parameter edit', async () => {
        const mocked = vi.mocked(generateToolPlanningOutcome);
        mocked.mockResolvedValueOnce({
            status: 'complete',
            toolCalls: [
                {
                    id: 'discover-1',
                    name: 'agent.catalog.discover',
                    arguments: { category: 'command', names: ['setDeviceParameter'] },
                },
            ],
        });
        mocked.mockResolvedValueOnce({
            status: 'complete',
            toolCalls: [
                {
                    id: 'propose-1',
                    name: 'command.batch.propose',
                    arguments: {
                        plan: providerPlan,
                        list: {
                            schemaVersion: 1,
                            items: [
                                {
                                    id: 'set-mix',
                                    name: 'setDeviceParameter',
                                    arguments: { paramId: 'mix', value: 0.25 },
                                    selector: {
                                        targetArgument: 'deviceId',
                                        entity: 'device',
                                        where: { name: 'Reverb', trackId: 'track-vocals', type: 'Reverb' },
                                        quantity: { unit: 'targets', exactly: 1 },
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });

        const result = await parsePromptToActions(
            'set the Reverb Mix on the Vocals track to 0.25',
            createContext(),
            undefined,
            'revision-processing-only-stamp'
        );

        expect(result.rejectionReason).toBeUndefined();
        expect(result.actions).toEqual([
            {
                type: 'setDeviceParameter',
                payload: {
                    deviceId: 'device-reverb',
                    paramId: 'mix',
                    value: 0.25,
                    expectedTrackId: 'track-vocals',
                    expectedDeviceType: 'Reverb',
                    expectedDeviceIds: ['device-reverb'],
                    expectedTrackFrozen: false,
                    expectedValue: 0.5,
                    automationRecordingPolicy: 'suppressed',
                },
            },
        ]);
    });
});

describe('processing-only policy boundaries', () => {
    afterEach(() => {
        clearHandlerRegistry();
    });

    it('never publishes the policy through the provider-facing tool schema', () => {
        const schemas = getExecutableAppActionToolSchemas();

        for (const actionType of ['setDeviceParameter', 'setTrackGain', 'setTrackPan'] as const) {
            const schema = schemas.find((candidate) => candidate.function.name === actionType);
            expect(schema).toBeDefined();
            expect(Object.keys(schema?.function.parameters.properties ?? {})).not.toContain(
                'automationRecordingPolicy'
            );
        }
    });

    it('compiles the stamped gain edit into a command envelope the runtime schema accepts', () => {
        registerHandlerMap(getArrangementHandlers());
        const context = createContext();
        const gainAction = materializeMixedBatch()[0]!;

        const compiled = compilePlannedActionCommandBatch({
            actions: [gainAction],
            actionLabels: ['Set track gain'],
            autoCommit: false,
            context,
            group: { groupId: 'processing-only-stamp', groupLabel: 'Processing-only stamp' },
            intent: 'Set the Vocals fader',
            projectRevision: 'revision-processing-only-stamp',
            runId: 'run-processing-only-stamp',
        });
        const parsed = parseVersionedCommandEnvelope(compiled.commandEnvelopes[0] ?? '');

        expect(parsed.status).toBe('valid');
        expect(parsed.status === 'valid' ? parsed.envelope.arguments.automationRecordingPolicy : undefined).toBe(
            'suppressed'
        );
    });
});
