import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    captureProjectRevision,
    createCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { AiProposalInvalidatedError } from '../../errors/AiProposalInvalidatedError';
import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { agentResourceLimitsStore } from '../../stores/agentResourceLimitsStore';
import { chatStore, clearChatMessages } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { buildPresetContext } from '../../transformers/promptParser/parsing';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { getProjectContext } from '../getProjectContext';
import { submitAdmittedPromptRequest } from '../submitAdmittedPromptRequest';
import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import { moveTrackFader, seedSavableProject, writeProjectSave } from './projectSaveFixture';

registerDeviceEnginePorts();
registerSupportingServicePorts();
const mocks = vi.hoisted(() => ({ parse: vi.fn<typeof import('../parsePromptToActions').parsePromptToActions>() }));
vi.mock('../parsePromptToActions', () => ({ parsePromptToActions: mocks.parse }));

beforeEach(() => {
    mocks.parse.mockReset();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('preset save test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    createCrdtDoc('child');
    registerCrdtStorageRuntime();
    registerHandlerMap(getArrangementHandlers());
    configureAiWorkflowCommandPreflightFixture();
    clearPendingActionConfirmations();
    clearChatMessages();
    agentRunLifecycle.clear();
    agentResourceLimitsStore.set(DEFAULT_AGENT_RESOURCE_LIMITS);
    trackStore.set({
        tracks: [createTrack({ id: 'track-1', name: 'Drum Bus', kind: 'audio' })],
        selectedTrackId: null,
        ghostClips: [],
    });
    seedSavableProject();
});
afterEach(() => {
    clearHandlerRegistry();
    resetAiWorkflowCommandPreflightFixture();
    clearPendingActionConfirmations();
    clearChatMessages();
    agentRunLifecycle.clear();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    projectStore.set(defaultProjectStoreState);
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
    removeCrdtDoc('child');
});

describe('selected preset planned across project writes', () => {
    it.each(['save', 'saved edit', 'unflushed edit', 'edit and revert', 'child edit'] as const)('%s', async (write) => {
        let capturedRevision = '';
        const initialGain = trackStore.value?.tracks[0]?.gain;
        const initialColor = trackStore.value?.tracks[0]?.color;
        if (initialGain === undefined) {
            throw new Error('Missing track');
        }
        mocks.parse.mockImplementationOnce(async ({ projectRevision }) => {
            if (typeof projectRevision !== 'string' || projectRevision.length === 0) {
                throw new Error('Expected a captured project revision');
            }
            capturedRevision = projectRevision;
            if (write === 'saved edit') {
                moveTrackFader('track-1', 0.5);
            }
            if (write === 'edit and revert') {
                moveTrackFader('track-1', 0.5);
                moveTrackFader('track-1', initialGain);
                expect(trackStore.value?.tracks[0]?.gain).toBe(initialGain);
            }
            if (write === 'child edit') {
                mutateCrdtDoc({
                    id: 'child',
                    changeFn: (doc: Record<string, unknown>) => {
                        doc.value = 'changed';
                    },
                });
            }
            if (write === 'unflushed edit') {
                const state = trackStore.value;
                if (!state) {
                    throw new Error('Missing tracks');
                }
                trackStore.set({ ...state, tracks: state.tracks.map((track) => ({ ...track, gain: 0.5 })) });
                expect(captureProjectRevision()).toBe(projectRevision);
            } else if (write === 'save' || write === 'saved edit') {
                await writeProjectSave();
                if (write === 'save') {
                    expect(captureProjectRevision()).not.toBe(projectRevision);
                }
            }
            return {
                actions: [{ type: 'setTrackColor', payload: { trackId: 'track-1', color: '#ff5500' } }],
                rawText: 'Color Drum Bus orange',
                requiresConfirmation: true,
                planningOutcome: { kind: 'proposal' },
            };
        });
        const pending = submitAdmittedPromptRequest({
            prompt: 'Color Drum Bus orange',
            source: 'preset',
            preset: { id: 'play', expectedContext: buildPresetContext(getProjectContext()) },
        });
        if (write !== 'save') {
            await expect(pending).rejects.toThrow(AiProposalInvalidatedError);
            expect(pendingActionConfirmationStore.value?.confirmations ?? []).toHaveLength(0);
            expect(chatStore.value?.messages.some((message) => message.pendingActionConfirmationId)).toBeFalsy();
            expect(trackStore.value?.tracks[0]?.color).toBe(initialColor);
            return;
        }
        const result = await pending;
        expect(result.status).toBe('awaiting-approval');
        if (result.status !== 'awaiting-approval') {
            throw new Error(result.status);
        }
        const card = getPendingActionConfirmation(result.confirmationId);
        expect(card).toMatchObject({
            runId: result.runId,
            status: 'proposed',
            projectRevision: capturedRevision,
            approvalSnapshot: { commandBatch: { authority: { baseRevision: capturedRevision } } },
        });
        expect(agentRunLifecycle.get(result.runId)?.phase).toBe('waiting-for-approval');
        expect(chatStore.value?.messages).toContainEqual(
            expect.objectContaining({ pendingActionConfirmationId: result.confirmationId })
        );
        expect(trackStore.value?.tracks[0]?.gain).toBe(initialGain);
        expect(trackStore.value?.tracks[0]?.color).toBe(initialColor);
    });
});
