import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import {
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { seedSavableProject, writeProjectSave } from '../../__tests__/projectSaveFixture';
import { executePromptCommandPreview } from '../executePromptCommandPreview';

const COMMAND_ID = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
    bindAbortController: vi.fn(),
    cancel: vi.fn(),
    claim: vi.fn(),
    createResourceLease: vi.fn(),
    executeBatch: vi.fn(),
    getRun: vi.fn(),
    loggerError: vi.fn(),
    onSettlementWarning: vi.fn(),
    settle: vi.fn(),
    settleSafely: vi.fn(),
    transitionPhase: vi.fn(),
    updateBatchStatus: vi.fn(),
    updateChatMessage: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: mocks.loggerError },
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
    executeVersionedCommandBatchEnvelope: mocks.executeBatch,
}));

vi.mock('../../../stores/chatStore', () => ({
    updateChatMessage: mocks.updateChatMessage,
}));

vi.mock('../../agentReference/createStemImportConfirmationResourceLease', () => ({
    createStemImportConfirmationResourceLease: mocks.createResourceLease,
}));

vi.mock('../../agentRunLifecycle', () => ({
    agentRunLifecycle: {
        get: mocks.getRun,
        transitionPhase: mocks.transitionPhase,
        updateBatchStatus: mocks.updateBatchStatus,
    },
}));

vi.mock('../../agentRunWorkLease', () => ({
    agentRunWorkLease: {
        claim: mocks.claim,
        settle: mocks.settle,
    },
}));

vi.mock('../../cancelAgentRun', () => ({
    agentRunCancellation: {
        bindAbortController: mocks.bindAbortController,
        cancel: mocks.cancel,
    },
}));

vi.mock('../settleAgentRunWorkLeaseSafely', () => ({
    settleAgentRunWorkLeaseSafely: mocks.settleSafely,
}));

function createInput(revision: string): Parameters<typeof executePromptCommandPreview>[0] {
    const action = {
        type: 'setTrackGain',
        payload: { trackId: 'track-kick', gain: 0.8, expectedGain: 1 },
    } satisfies AppAction;
    const command = {
        ...createVersionedCommandEnvelope({
            action,
            availableDeviceVersions: {},
            expectedEffect: 'Set Kick gain to 0.8.',
            normalizedProjectRevision: revision,
            objectReferences: [{ argument: 'trackId', id: 'track-kick', scope: 'stable' }],
            parameterUnits: [
                { argument: 'gain', unit: 'linear-gain' },
                { argument: 'expectedGain', unit: 'linear-gain' },
            ],
            reason: 'Preview the Kick gain change.',
            time: [],
        }),
        commandId: COMMAND_ID,
    };
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: 'run-preview',
        batchId: 'batch-preview',
        projectId: 'project-preview',
        baseRevision: revision,
        intent: 'Preview the Kick gain',
        mode: 'preview',
        commands: [serializeVersionedCommandEnvelope(command)],
    });
    const parsedCommandBatch = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsedCommandBatch.status === 'invalid') {
        throw new Error(parsedCommandBatch.reason);
    }
    return {
        runId: 'run-preview',
        assistantMessageId: 'assistant-preview',
        actions: [action],
        actionLabels: ['Set Kick gain'],
        abortController: new AbortController(),
        projectRevision: revision,
        commandBatch,
        parsedCommandBatch,
        onExecutionSettlementWarning: mocks.onSettlementWarning,
    };
}

describe('preview failure classification after actual save writes', () => {
    const releaseCancellation = vi.fn();
    const releaseResources = vi.fn();
    beforeEach(() => {
        vi.resetAllMocks();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerSupportingServicePorts();
        seedSavableProject();
        trackStore.set({
            tracks: [createTrack({ id: 'track-kick', name: 'Kick', kind: 'audio' })],
            selectedTrackId: 'track-kick',
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        mocks.claim.mockReturnValue({
            status: 'claimed',
            lease: { runId: 'run-preview', workId: 'preview:batch-preview' },
        });
        mocks.bindAbortController.mockReturnValue(releaseCancellation);
        mocks.createResourceLease.mockReturnValue({ releaseBestEffort: releaseResources });
        releaseResources.mockResolvedValue(undefined);
        mocks.settleSafely.mockReturnValue({ accepted: true, warning: null });
    });
    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it.each(['rejected', 'conflicted', 'failed', 'cancelled'] as const)(
        'retains the original %s reason after an actual save',
        async (status) => {
            let finish!: (value: { status: typeof status; reason: string }) => void;
            mocks.executeBatch.mockReturnValue(
                new Promise((resolve) => {
                    finish = resolve;
                })
            );
            const revision = captureProjectRevision();
            const input = createInput(revision);
            const pending = executePromptCommandPreview(input);
            const before = JSON.stringify(getCrdtDoc('root'));
            await writeProjectSave();
            expect(captureProjectRevision()).not.toBe(revision);
            expect(JSON.stringify(getCrdtDoc('root'))).not.toBe(before);
            const failed = expect(pending).rejects.toThrow('original preview failure');
            finish({ status, reason: 'original preview failure' });
            await failed;
            if (status === 'cancelled') {
                expect(mocks.cancel).toHaveBeenCalledWith({ runId: 'run-preview', reason: 'original preview failure' });
            } else {
                expect(mocks.cancel).not.toHaveBeenCalled();
            }
            expect(mocks.executeBatch).toHaveBeenCalledWith(input.commandBatch);
            expect(mocks.updateChatMessage).not.toHaveBeenCalled();
            expect(mocks.settleSafely).toHaveBeenCalledWith(
                expect.objectContaining({
                    terminalState: status === 'cancelled' ? 'cancelled' : 'failed',
                    evidence: 'none',
                })
            );
            expect(releaseCancellation).toHaveBeenCalledOnce();
            expect(releaseResources).toHaveBeenCalledOnce();
        }
    );

    it.each(['saved', 'unflushed', 'reverted'] as const)(
        'still cancels a failed preview after a %s fader edit',
        async (edit) => {
            let finish!: (value: { status: 'failed'; reason: string }) => void;
            mocks.executeBatch.mockReturnValue(
                new Promise((resolve) => {
                    finish = resolve;
                })
            );
            const revision = captureProjectRevision();
            const pending = executePromptCommandPreview(createInput(revision));
            const state = trackStore.value;
            if (!state) {
                throw new Error('Expected tracks');
            }
            vi.stubGlobal('requestAnimationFrame', () => 0);
            trackStore.set({ ...state, tracks: state.tracks.map((track) => ({ ...track, gain: 0.6 })) });
            if (edit === 'unflushed') {
                expect(captureProjectRevision()).toBe(revision);
            } else {
                flushAutomergeStorageWrites();
                if (edit === 'reverted') {
                    trackStore.set(state);
                    flushAutomergeStorageWrites();
                }
                await writeProjectSave();
            }
            const failed = expect(pending).rejects.toThrow('original edit failure');
            finish({ status: 'failed', reason: 'original edit failure' });
            await failed;
            expect(mocks.cancel).toHaveBeenCalledWith({ runId: 'run-preview', reason: 'original edit failure' });
            expect(releaseCancellation).toHaveBeenCalledOnce();
            expect(releaseResources).toHaveBeenCalledOnce();
        }
    );
});
