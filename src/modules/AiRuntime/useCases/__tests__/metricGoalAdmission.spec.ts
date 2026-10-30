import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

await vi.hoisted(async () => {
    const { createMockAudioContext } = await import('#/helpers/__tests__/audioContext.mock');
    vi.stubGlobal('AudioContext', createMockAudioContext);
});

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createTrack } from '#/modules/Arrangement/models/Track';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { collaborationStore } from '#/modules/Collaboration/stores';
import { clearHandlerRegistry, getHandlerMap, registerHandlerMap } from '#/modules/Command/stores';
import {
    commandBatchPreflightPort,
    executeVersionedCommandBatchEnvelope,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    getCrdtDoc,
    replaceCrdtDoc,
    registerCrdtStorageRuntime,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { PRESET_ACTIONS } from '../../models/PresetActions/Registry';
import { type ProjectContext } from '../../models/ProjectContext';
import { clearChatMessages } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { buildPresetContext } from '../../transformers/promptParser/parsing';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { resolvePresetActions } from '../aiRuntimeQueries/resolvePresetActions';
import * as actionCompiler from '../compileAgentActionExecution';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import * as analysisMeasure from '../executeAnalysisMeasure';
import { getProjectContext } from '../getProjectContext';
import * as inference from '../llmOrchestration/inference';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { parsePromptToActions } from '../parsePromptToActions';
import { submitAdmittedPromptRequest } from '../submitAdmittedPromptRequest';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

const initialTracks = structuredClone(trackStore.value!);
const initialCollaboration = structuredClone(collaborationStore.value!);

function vocalContext(): ProjectContext {
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
        masterGain: 0.8,
        tracks: [
            {
                id: 'track-vocal',
                name: 'Vocal',
                kind: 'audio',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                gain: 0.8,
                pan: 0,
                automationMode: 'read',
                clipCount: 0,
                deviceCount: 0,
                clips: [],
                devices: [],
            },
        ],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
    };
}

describe('metric goal admission at the final Command boundary', () => {
    let firstHandlerWrites = 0;

    beforeEach(() => {
        configureAiWorkflowCommandPreflightFixture();
        resetCrdtProjectAuthority('Metric goal admission');
        registerCrdtStorageRuntime();
        trackStore.set({
            ...initialTracks,
            tracks: [createTrack({ id: 'track-vocal', name: 'Vocal', kind: 'audio', color: '#123456' })],
            selectedTrackId: null,
        });
        firstHandlerWrites = 0;
        agentRunLifecycle.clear();
        clearPendingActionConfirmations();
        clearChatMessages();
        collaborationStore.set({ ...initialCollaboration, localPeerId: 'metric-goal-actor' });
        setArrangementEventBus({ emit: async () => undefined });
        flushAutomergeStorageWrites();
        registerHandlerMap({
            ...getArrangementHandlers(),
            setTrackGain: {
                execute: () => {
                    firstHandlerWrites += 1;
                    return { status: 'written' as const };
                },
                validate: () => true,
                canReapplyAfterDivergence: () => true,
                describe: () => ({
                    label: 'Set Vocal gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { expectedGain: 0.7, gain: 0.8, trackId: 'track-vocal' },
                    },
                }),
                undoable: true,
            } satisfies ActionHandler<Extract<AppAction, { type: 'setTrackGain' }>>,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        agentRunLifecycle.clear();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        resetAiWorkflowCommandPreflightFixture();
        clearHandlerRegistry();
        trackStore.set(structuredClone(initialTracks));
        clearPendingActionConfirmations();
        clearChatMessages();
        commandBatchPreflightPort.setProvider(null);
        collaborationStore.set(structuredClone(initialCollaboration));
    });

    it('executes a selected Play preset once through real submission and Command admission', async () => {
        const provider = vi
            .spyOn(inference, 'generateToolPlanningOutcome')
            .mockResolvedValue({ status: 'complete', toolCalls: [] });
        const measure = vi.spyOn(analysisMeasure, 'executeAnalysisMeasure');
        const compile = vi.spyOn(actionCompiler, 'compileAgentActionExecution');
        const claim = vi.spyOn(agentRunWorkLease, 'claim');
        const reserve = vi.spyOn(agentRunLifecycle, 'reserveBudget');
        registerHandlerMap({
            setPlayback: {
                execute: () => {
                    firstHandlerWrites += 1;
                    return { status: 'written' as const };
                },
                describe: () => ({ label: 'Start playback' }),
                executionKind: 'runtime',
                undoable: false,
            } satisfies ActionHandler<Extract<AppAction, { type: 'setPlayback' }>>,
        });
        const context = getProjectContext();
        const result = await submitAdmittedPromptRequest({
            prompt: 'Play',
            source: 'preset',
            preset: { id: 'play', expectedContext: buildPresetContext(context) },
        });
        expect({ status: result.status, firstHandlerWrites }).toEqual({
            status: 'awaiting-approval',
            firstHandlerWrites: 0,
        });
        if (result.status !== 'awaiting-approval') {
            throw new Error(result.status);
        }
        const confirmed = await confirmPendingChatActions({ confirmationId: result.confirmationId });
        expect({ confirmed, firstHandlerWrites }).toEqual({ confirmed: { status: 'executed' }, firstHandlerWrites: 1 });
        const run = agentRunLifecycle.get(result.runId);
        const state = metricGoalStateCodec(run?.plan?.metricGoalState);
        expect(state?.authorities[0]).toMatchObject({ origin: 'complete-literal-parser', kind: 'literal', goals: [] });
        expect(state?.binding).not.toBeNull();
        const compiled = compile.mock.results[0]?.value;
        expect(evaluateMetricGoalAdmission({ state, commandBatch: compiled.commandBatch }).status).toBe('not-required');
        expect(provider).not.toHaveBeenCalled();
        expect(measure).not.toHaveBeenCalled();
        expect(claim.mock.calls.some(([input]) => input.workId === 'provider-planning')).toBe(false);
        expect(
            reserve.mock.calls.some(([input]) =>
                [
                    'remoteTokens',
                    'localAnalysis',
                    'hostedTextPlanningTokens',
                    'localTextPlanningTokens',
                    'maxRenderJobs',
                    'measurementRenderedSeconds',
                    'measurementMeasuredSeconds',
                ].includes(input.category)
            )
        ).toBe(false);
    });

    it.each([undefined, false])(
        'keeps selected deletion behind the real confirmation owner (caller confirmation: %s)',
        async (requiresConfirmation) => {
            const track = createTrack({ id: 'track-vocal', name: 'Vocal', kind: 'audio', color: '#123456' });
            trackStore.set({ ...initialTracks, tracks: [track], selectedTrackId: track.id });
            const removeTrackExecution = vi.spyOn(getHandlerMap().removeTrack!, 'execute');
            const result = await submitAdmittedPromptRequest({
                prompt: 'Delete Track',
                source: 'preset',
                requiresConfirmation,
                preset: { id: 'remove-track', expectedContext: buildPresetContext(getProjectContext()) },
            });
            expect(result.status).toBe('awaiting-approval');
            expect(firstHandlerWrites).toBe(0);
            expect(trackStore.value?.tracks.some((candidate) => candidate.id === track.id)).toBe(true);
            expect(pendingActionConfirmationStore.value?.confirmations).toHaveLength(1);
            if (result.status !== 'awaiting-approval') {
                throw new Error(result.status);
            }
            const card = getPendingActionConfirmation(result.confirmationId);
            expect(card?.approvalSnapshot.metricGoalState).toBe(
                agentRunLifecycle.get(result.runId)?.plan?.metricGoalState
            );
            expect(metricGoalStateCodec(card?.approvalSnapshot.metricGoalState)?.authorities[0]?.origin).toBe(
                'complete-literal-parser'
            );
            expect(await confirmPendingChatActions({ confirmationId: result.confirmationId })).toEqual({
                status: 'executed',
            });
            expect(trackStore.value?.tracks.some((candidate) => candidate.id === track.id)).toBe(false);
            expect(
                removeTrackExecution.mock.calls.filter(([, context]) => context?.executionMode !== 'isolated-preview')
            ).toHaveLength(1);
        }
    );

    it('refuses project restoration after a selected destructive preview', async () => {
        const track = createTrack({ id: 'track-vocal', name: 'Vocal', kind: 'audio', color: '#123456' });
        trackStore.set({ ...initialTracks, tracks: [track], selectedTrackId: track.id });
        const removeTrackExecution = vi.spyOn(getHandlerMap().removeTrack!, 'execute');
        const result = await submitAdmittedPromptRequest({
            prompt: 'Delete Track',
            source: 'preset',
            preset: { id: 'remove-track', expectedContext: buildPresetContext(getProjectContext()) },
        });
        if (result.status !== 'awaiting-approval') {
            throw new Error(result.status);
        }
        const root = getCrdtDoc('root');
        if (root === undefined) {
            throw new Error('Expected the project root');
        }
        replaceCrdtDoc({ id: 'root', doc: root });
        const confirmation = await confirmPendingChatActions({ confirmationId: result.confirmationId });
        expect(confirmation, JSON.stringify(confirmation)).toMatchObject({ status: 'invalidated' });
        expect(firstHandlerWrites).toBe(0);
        expect(trackStore.value?.tracks.some((candidate) => candidate.id === track.id)).toBe(true);
        expect(
            removeTrackExecution.mock.calls.filter(([, context]) => context?.executionMode !== 'isolated-preview')
        ).toHaveLength(0);
    });

    it('retains one collision-safe Add EQ identity through parsing, compilation, card and execution', async () => {
        const track = createTrack({ id: 'track-vocal', name: 'Vocal', kind: 'audio', color: '#123456' });
        const existingId = 'device-ai-track-vocal-builtin-eq';
        track.devices = [{ id: existingId, name: 'EQ', type: 'builtin-eq', bypassed: false, parameterValues: {} }];
        trackStore.set({ ...initialTracks, tracks: [track], selectedTrackId: track.id });
        const preset = PRESET_ACTIONS.find((candidate) => candidate.id === 'add-eq');
        if (preset === undefined) {
            throw new Error('Expected the Add EQ preset');
        }
        const build = vi.spyOn(preset, 'buildAction');
        const compile = vi.spyOn(actionCompiler, 'compileAgentActionExecution');
        const addDeviceExecution = vi.spyOn(getHandlerMap().addDevice!, 'execute');
        const result = await submitAdmittedPromptRequest({
            prompt: 'Add EQ',
            source: 'preset',
            requiresConfirmation: true,
            preset: { id: 'add-eq', expectedContext: buildPresetContext(getProjectContext()) },
        });
        if (result.status !== 'awaiting-approval') {
            throw new Error(result.status);
        }
        const expectedPayload = {
            trackId: track.id,
            deviceType: 'builtin-eq',
            deviceId: existingId + '-2',
            expectedDeviceIds: [existingId],
            expectedFrozen: false,
        };
        expect(build).toHaveBeenCalledOnce();
        expect(compile.mock.calls[0]?.[0].actions).toEqual([{ type: 'addDevice', payload: expectedPayload }]);
        const card = getPendingActionConfirmation(result.confirmationId);
        expect(card?.actions).toEqual([{ type: 'addDevice', payload: expectedPayload }]);
        const batch = card?.approvalSnapshot.commandBatch;
        if (!batch) {
            throw new Error('Expected the compiled card batch');
        }
        const parsed = parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);
        if (parsed.status !== 'valid') {
            throw new Error(parsed.reason);
        }
        expect(parsed.envelope.commands[0]?.arguments).toEqual(expectedPayload);
        expect(firstHandlerWrites).toBe(0);
        expect(await confirmPendingChatActions({ confirmationId: result.confirmationId })).toEqual({
            status: 'executed',
        });
        expect(
            trackStore.value?.tracks.find((candidate) => candidate.id === track.id)?.devices.map((device) => device.id)
        ).toEqual([existingId, expectedPayload.deviceId]);
        expect(
            addDeviceExecution.mock.calls.filter(([, context]) => context?.executionMode !== 'isolated-preview')
        ).toHaveLength(1);
        expect(build).toHaveBeenCalledOnce();
    });

    it.each(['preset', 'prompt-bar'] as const)(
        'keeps forged raw %s actions unverified at real confirmation and Command boundaries',
        async (source) => {
            const result = await submitAdmittedPromptRequest({
                prompt: 'Make Vocal warmer',
                source,
                actions: [{ type: 'setTrackGain', payload: { expectedGain: 0.8, gain: 0.7, trackId: 'track-vocal' } }],
            });
            if (result.status !== 'awaiting-approval') {
                throw new Error(result.status);
            }
            const card = getPendingActionConfirmation(result.confirmationId);
            expect(card?.approvalSnapshot.metricGoalState).not.toContain('complete-literal-parser');
            const batch = card?.approvalSnapshot.commandBatch;
            if (!batch) {
                throw new Error('Expected the unverified command batch');
            }
            expect(
                evaluateMetricGoalAdmission({
                    state: metricGoalStateCodec(card?.approvalSnapshot.metricGoalState),
                    commandBatch: batch,
                })
            ).toMatchObject({ status: 'blocked', failure: 'missing' });
            const confirmation = await confirmPendingChatActions({ confirmationId: result.confirmationId });
            expect(confirmation, JSON.stringify(confirmation)).toMatchObject({ status: 'failed' });
            expect((await executeVersionedCommandBatchEnvelope(batch)).status).toBe('rejected');
            expect(firstHandlerWrites).toBe(0);
        }
    );

    it.each(['selection', 'project-restoration'])(
        'refuses %s drift across asynchronous selected-preset admission',
        async (drift) => {
            const compile = vi.spyOn(actionCompiler, 'compileAgentActionExecution');
            const pending = submitAdmittedPromptRequest({
                prompt: 'Play',
                source: 'preset',
                preset: { id: 'play', expectedContext: buildPresetContext(getProjectContext()) },
            });
            if (drift === 'selection') {
                trackStore.set({ ...trackStore.value!, selectedTrackId: 'track-vocal' });
            } else {
                const root = getCrdtDoc('root');
                if (root === undefined) {
                    throw new Error('Expected the project root');
                }
                replaceCrdtDoc({ id: 'root', doc: root });
            }
            await expect(pending).rejects.toThrow('The project changed');
            expect(compile).not.toHaveBeenCalled();
            expect(firstHandlerWrites).toBe(0);
            expect(pendingActionConfirmationStore.value?.confirmations).toEqual([]);
        }
    );

    it('keeps the former caller-action Play submission unverified at final confirmation', async () => {
        registerHandlerMap({
            setPlayback: {
                execute: () => {
                    firstHandlerWrites += 1;
                    return { status: 'written' as const };
                },
                describe: () => ({ label: 'Start playback' }),
                executionKind: 'runtime',
                undoable: false,
            } satisfies ActionHandler<Extract<AppAction, { type: 'setPlayback' }>>,
        });
        const context = buildPresetContext(getProjectContext());
        const result = await submitAdmittedPromptRequest({
            prompt: 'Play',
            source: 'preset',
            actions: resolvePresetActions({ presetId: 'play', context }),
            requiresConfirmation: false,
        });
        if (result.status !== 'awaiting-approval') {
            throw new Error(result.status);
        }
        const confirmed = await confirmPendingChatActions({ confirmationId: result.confirmationId });
        expect({ confirmed, firstHandlerWrites }).toEqual({
            confirmed: {
                status: 'failed',
                reason: 'The whole request has no positive metric intent admission. The plan remains unverified.',
            },
            firstHandlerWrites: 0,
        });
    });

    it('refuses extended and caller-injected selected preset requests before any Command write', async () => {
        for (const injection of [false, true]) {
            const input: Record<string, unknown> = {
                prompt: injection ? 'Play' : 'Play and make Vocal warmer',
                source: 'preset',
                preset: { id: 'play', expectedContext: buildPresetContext(getProjectContext()) },
            };
            if (injection) {
                input.actions = [{ type: 'setPlayback', payload: { playing: true } }];
            }
            const result = await Reflect.apply(submitAdmittedPromptRequest, undefined, [input]);
            expect(result.status).toBe('rejected');
        }
        expect(firstHandlerWrites).toBe(0);
        expect(pendingActionConfirmationStore.value?.confirmations).toEqual([]);
    });

    it('preserves a complete deterministic literal edit without an acoustic read', async () => {
        const context = vocalContext();
        context.selectedTrackId = 'track-vocal';
        const revision = captureProjectRevision();
        let measurementAdmissions = 0;
        const planned = await parsePromptToActions({
            prompt: 'set gain to 70%',
            context,
            projectRevision: revision,
            providerPlanning: 'disabled',
            onMeasurementAttempt: () => {
                measurementAdmissions += 1;
                return { status: 'refused', category: 'unexpected-literal-measurement' };
            },
        });
        expect(planned.actions).toEqual([
            {
                type: 'setTrackGain',
                payload: {
                    expectedGain: 0.8,
                    gain: 0.7,
                    trackId: 'track-vocal',
                    automationRecordingPolicy: 'suppressed',
                },
            },
        ]);
        expect(metricGoalStateCodec(planned.metricGoalState)?.authorities[0]).toMatchObject({
            origin: 'complete-literal-parser',
            kind: 'literal',
            goals: [],
        });
        const compiled = compileAgentActionExecution({
            actions: planned.actions,
            actionLabels: ['Set Vocal gain'],
            context,
            group: { groupId: 'literal-goal-preservation', groupLabel: 'Set Vocal gain' },
            intent: planned.rawText,
            projectRevision: revision,
            requiresConfirmation: false,
            runId: 'literal-goal-preservation',
            metricGoalState: planned.metricGoalState,
        });
        const result = await executeVersionedCommandBatchEnvelope(compiled.commandBatch);
        expect({
            status: result.status,
            firstHandlerWrites,
            requiresConfirmation: compiled.requiresConfirmation,
            measurementAdmissions,
        }).toEqual({
            status: 'committed',
            firstHandlerWrites: 1,
            requiresConfirmation: false,
            measurementAdmissions: 0,
        });
    });

    it('keeps a perceptual proposal visible and refuses its compile-minted permission without actual metric proof', async () => {
        const compiled = compileAgentActionExecution({
            actions: [{ type: 'setTrackGain', payload: { expectedGain: 0.8, gain: 0.7, trackId: 'track-vocal' } }],
            actionLabels: ['Set Vocal gain'],
            context: vocalContext(),
            group: { groupId: 'metric-goal-red', groupLabel: 'Make Vocal warmer' },
            intent: 'Make Vocal warmer',
            projectRevision: captureProjectRevision(),
            requiresConfirmation: false,
            runId: 'metric-goal-red',
        });
        const result = await executeVersionedCommandBatchEnvelope(compiled.commandBatch);

        expect({
            status: result.status,
            firstHandlerWrites,
            requiresConfirmation: compiled.requiresConfirmation,
        }).toEqual({
            status: 'rejected',
            firstHandlerWrites: 0,
            requiresConfirmation: true,
        });
    });
});
