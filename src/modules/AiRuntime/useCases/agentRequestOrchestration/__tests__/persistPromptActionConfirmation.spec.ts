import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { persistPromptActionConfirmation } from '../persistPromptActionConfirmation';

const COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const REMOVE_COMMAND_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
    createResourceLease: vi.fn(),
    describeRisk: vi.fn(),
    normalizeFailure: vi.fn(),
    proposeConfirmation: vi.fn(),
    recordError: vi.fn(),
    transitionPhase: vi.fn(),
    updateBatchStatus: vi.fn(),
    updateChatMessage: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../stores/chatStore', () => ({
    updateChatMessage: mocks.updateChatMessage,
}));

vi.mock('../../../stores/pendingActionConfirmationStore', () => ({
    proposePendingActionConfirmation: mocks.proposeConfirmation,
}));

vi.mock('../../agentErrorAndSaga', () => ({
    normalizeAgentFailure: mocks.normalizeFailure,
}));

vi.mock('../../agentReference/createStemImportConfirmationResourceLease', () => ({
    createStemImportConfirmationResourceLease: mocks.createResourceLease,
}));

vi.mock('../../agentRunLifecycle', () => ({
    agentRunLifecycle: {
        recordError: mocks.recordError,
        transitionPhase: mocks.transitionPhase,
        updateBatchStatus: mocks.updateBatchStatus,
    },
}));

vi.mock('../../describeAgentRiskApproval', () => ({
    describeAgentRiskApproval: mocks.describeRisk,
}));

type CommandShape = {
    action: AppAction;
    commandId: string;
    dynamicEffects?: Parameters<typeof compileVersionedCommandBatchEnvelope>[0]['dynamicEffects'];
    expectedEffect: string;
    label: string;
    parameterUnits: Parameters<typeof createVersionedCommandEnvelope>[0]['parameterUnits'];
    reason: string;
};

const GAIN_COMMAND: CommandShape = {
    action: { type: 'setTrackGain', payload: { trackId: 'track-kick', gain: 0.8, expectedGain: 1 } },
    commandId: COMMAND_ID,
    expectedEffect: 'Set Kick gain to 0.8.',
    label: 'Set Kick gain',
    parameterUnits: [
        { argument: 'gain', unit: 'linear-gain' },
        { argument: 'expectedGain', unit: 'linear-gain' },
    ],
    reason: 'Apply the confirmed Kick gain.',
};

const REMOVE_COMMAND: CommandShape = {
    action: { type: 'removeTrack', payload: { trackId: 'track-kick' } },
    commandId: REMOVE_COMMAND_ID,
    // Removing a track deletes whatever it holds, so the compiler refuses the batch without bounds.
    dynamicEffects: { affectedTrackIds: ['track-kick'], deletedObjects: 1 },
    expectedEffect: 'Remove the Kick track.',
    label: 'Remove Kick',
    parameterUnits: [],
    reason: 'Drop the track the request retires.',
};

function createInputFor(shape: CommandShape): Parameters<typeof persistPromptActionConfirmation>[0] {
    const action = shape.action;
    const command = {
        ...createVersionedCommandEnvelope({
            action,
            availableDeviceVersions: {},
            expectedEffect: shape.expectedEffect,
            normalizedProjectRevision: 'revision-confirmation',
            objectReferences: [{ argument: 'trackId', id: 'track-kick', scope: 'stable' }],
            parameterUnits: shape.parameterUnits,
            reason: shape.reason,
            time: [],
        }),
        commandId: shape.commandId,
    };
    const serializedCommand = serializeVersionedCommandEnvelope(command);
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: 'run-confirmation',
        batchId: 'batch-confirmation',
        projectId: 'project-confirmation',
        baseRevision: 'revision-confirmation',
        intent: 'Set the Kick gain',
        commands: [serializedCommand],
        dynamicEffects: shape.dynamicEffects,
        protectedTargetIds: ['track-vocals'],
    });
    const parsedCommandBatch = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsedCommandBatch.status === 'invalid') {
        throw new Error(parsedCommandBatch.reason);
    }
    return {
        runId: 'run-confirmation',
        prompt: 'Set the kick gain',
        assistantMessageId: 'assistant-confirmation',
        actions: [action],
        actionLabels: [shape.label],
        commandEnvelopes: [serializedCommand],
        commandBatch,
        agentApproval: {
            schemaVersion: 1,
            actionHashes: ['action-hash-set-kick-gain'],
            sourceRevision: 'revision-confirmation',
            targetFingerprints: { 'track-kick': 'fingerprint-kick' },
            advertisedTargetFingerprints: {},
            consequences: {
                audioUpload: false,
                fileAccess: false,
                maxImportedAssets: 0,
                maxRenderJobs: 0,
                remoteGeneration: false,
            },
            localActorId: 'actor-confirmation',
            policy: {
                decision: 'confirm',
                reasons: ['Changes an existing track.'],
                requiredTrustMode: 'apply-reversible',
                risk: 'bounded-reversible',
            },
        },
        affectedIds: ['track-kick'],
        protectedUnchanged: [{ id: 'track-vocals', name: 'Vocals' }],
        executionMode: 'atomic',
        group: { groupId: 'group-confirmation', groupLabel: 'Set Kick gain' },
        projectRevision: 'revision-confirmation',
        parsedCommandBatch,
        content: 'Set Kick gain?',
    };
}

function createInput(): Parameters<typeof persistPromptActionConfirmation>[0] {
    return createInputFor(GAIN_COMMAND);
}

function createRemoveTrackInput(): Parameters<typeof persistPromptActionConfirmation>[0] {
    return createInputFor(REMOVE_COMMAND);
}

const gainHandler = {
    describe: () => ({ label: 'Set Kick gain', inverseAction: null }),
    execute: () => ({ status: 'written' as const }),
    undoable: true,
    validate: () => true,
};

describe('persistPromptActionConfirmation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.describeRisk.mockReturnValue('Risk approval required.');
        mocks.createResourceLease.mockReturnValue({ bytes: 64 });
        clearHandlerRegistry();
        registerHandlerMap({ setTrackGain: gainHandler });
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it('records a terminal capacity rejection in exact lifecycle and chat order', () => {
        const ordering: string[] = [];
        const normalizedFailure = { code: 'normalized-budget-failure' };
        mocks.createResourceLease.mockImplementation(() => {
            ordering.push('resource-lease');
            return { bytes: 64 };
        });
        mocks.proposeConfirmation.mockImplementation(() => {
            ordering.push('proposal-rejected');
            return null;
        });
        mocks.updateBatchStatus.mockImplementation(() => ordering.push('batch-failed'));
        mocks.normalizeFailure.mockReturnValue(normalizedFailure);
        mocks.recordError.mockImplementation(() => ordering.push('terminal-error'));
        mocks.updateChatMessage.mockImplementation(() => ordering.push('failed-chat'));
        mocks.transitionPhase.mockImplementation(() => ordering.push('success-transition'));

        persistPromptActionConfirmation(createInput());

        expect(ordering).toEqual([
            'resource-lease',
            'proposal-rejected',
            'batch-failed',
            'terminal-error',
            'failed-chat',
        ]);
        expect(mocks.updateBatchStatus).toHaveBeenCalledWith({
            runId: 'run-confirmation',
            batchId: 'batch-confirmation',
            status: 'failed',
        });
        expect(mocks.normalizeFailure).toHaveBeenCalledWith({
            category: 'budget',
            source: 'command-execution',
            related: {
                targetIds: ['track-kick'],
                commandIds: [COMMAND_ID],
                workIds: ['batch-confirmation'],
            },
            retry: 'never',
            knownDomain: true,
        });
        expect(mocks.recordError).toHaveBeenCalledWith({
            runId: 'run-confirmation',
            error: normalizedFailure,
            terminal: true,
        });
        expect(mocks.updateChatMessage).toHaveBeenCalledWith('assistant-confirmation', {
            isStreaming: false,
            pendingActionConfirmationStatus: 'failed',
            error: 'Prepared action resources exceed the live confirmation limit.',
            content:
                'This proposal was not retained because pending prepared resources reached their safe limit. Resolve or cancel an earlier proposal, then try again.',
        });
        expect(mocks.transitionPhase).not.toHaveBeenCalled();
    });

    it('publishes the retained confirmation before waiting for approval', () => {
        const ordering: string[] = [];
        const resourceLease = { bytes: 64 };
        mocks.createResourceLease.mockImplementation(() => {
            ordering.push('resource-lease');
            return resourceLease;
        });
        mocks.proposeConfirmation.mockImplementation(() => {
            ordering.push('proposal-retained');
            return { id: 'retained-confirmation' };
        });
        mocks.updateChatMessage.mockImplementation(() => ordering.push('proposed-chat'));
        mocks.transitionPhase.mockImplementation(() => ordering.push('waiting-for-approval'));

        const input = createInput();
        persistPromptActionConfirmation(input);

        expect(ordering).toEqual(['resource-lease', 'proposal-retained', 'proposed-chat', 'waiting-for-approval']);
        const proposal = mocks.proposeConfirmation.mock.calls[0]?.[0];
        expect(proposal).toEqual(
            expect.objectContaining({
                id: expect.stringMatching(/^prompt-confirmation-/),
                runId: 'run-confirmation',
                prompt: 'Set the kick gain',
                assistantMessageId: 'assistant-confirmation',
                actionLabels: ['Set Kick gain'],
                commandEnvelopes: input.commandEnvelopes,
                commandBatch: input.commandBatch,
                affectedIds: ['track-kick'],
                protectedUnchanged: [{ id: 'track-vocals', name: 'Vocals' }],
                risk: { level: 'bounded-reversible', reason: 'Changes an existing track.' },
                executionMode: 'atomic',
                groupId: 'group-confirmation',
                groupLabel: 'Set Kick gain',
                projectRevision: 'revision-confirmation',
                resourceLease,
            })
        );
        expect(mocks.createResourceLease).toHaveBeenCalledWith(
            input.actions,
            `stem-promotion:${String(proposal?.id)}`,
            'run-confirmation'
        );
        expect(mocks.updateChatMessage).toHaveBeenCalledWith('assistant-confirmation', {
            isStreaming: false,
            pendingActionConfirmationId: proposal?.id,
            pendingActionConfirmationStatus: 'proposed',
            content: 'Set Kick gain?\n\nRisk approval required.',
        });
        expect(mocks.transitionPhase).toHaveBeenCalledWith({
            runId: 'run-confirmation',
            phase: 'waiting-for-approval',
            revision: 'revision-confirmation',
        });
        expect(mocks.updateBatchStatus).not.toHaveBeenCalled();
        expect(mocks.recordError).not.toHaveBeenCalled();
    });

    // Red when the stored proposal carries no semantic diff, or one whose recoveries ignore the registry.
    it('stores a semantic diff keyed by the envelope group ids with registry-derived recoveries', () => {
        mocks.proposeConfirmation.mockReturnValue({ id: 'retained-confirmation' });
        clearHandlerRegistry();
        registerHandlerMap({
            setTrackGain: {
                ...gainHandler,
                describe: () => ({
                    label: 'Set Kick gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 'track-kick', gain: 1, expectedGain: 0.8 },
                    },
                }),
            },
        });

        persistPromptActionConfirmation(createInput());

        const semanticDiff = mocks.proposeConfirmation.mock.calls[0]?.[0]?.semanticDiff;
        expect(semanticDiff).toMatchObject({ batchId: 'batch-confirmation', baseRevision: 'revision-confirmation' });
        expect(semanticDiff?.intentGroups.map((group: { id: string }) => group.id)).toEqual([COMMAND_ID]);
        expect(mocks.warn).not.toHaveBeenCalled();
    });

    // Red when a handler that cannot describe its action aborts the proposal instead of degrading the diff.
    it('degrades a destructive change to irreversible and warns when the batch cannot be described', () => {
        mocks.proposeConfirmation.mockReturnValue({ id: 'retained-confirmation' });
        const removeInput = createRemoveTrackInput();
        clearHandlerRegistry();
        registerHandlerMap({
            removeTrack: {
                ...gainHandler,
                describe: () => ({
                    label: 'Remove Kick',
                    inverseAction: { type: 'addTrack', payload: { name: 'Kick', kind: 'audio' } },
                }),
            },
        });

        persistPromptActionConfirmation(removeInput);

        expect(mocks.proposeConfirmation.mock.calls[0]?.[0]?.semanticDiff?.destructiveChanges).toEqual([
            expect.objectContaining({ groupId: REMOVE_COMMAND_ID, recovery: 'inverse' }),
        ]);
        expect(mocks.warn).not.toHaveBeenCalled();

        mocks.proposeConfirmation.mockClear();
        clearHandlerRegistry();
        registerHandlerMap({
            removeTrack: {
                ...gainHandler,
                describe: () => {
                    throw new Error('the kick track is gone');
                },
            },
        });

        persistPromptActionConfirmation(createRemoveTrackInput());

        expect(mocks.warn).toHaveBeenCalledWith(
            'Command batch recovery could not be described: Could not preflight removeTrack: the kick track is gone'
        );
        expect(mocks.proposeConfirmation.mock.calls[0]?.[0]?.semanticDiff?.destructiveChanges).toEqual([
            expect.objectContaining({ groupId: REMOVE_COMMAND_ID, recovery: 'irreversible' }),
        ]);
        expect(mocks.transitionPhase).toHaveBeenCalledTimes(2);
    });
});
