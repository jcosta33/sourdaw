import { createRef, type ReactElement, useState } from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { useStore } from '#/infra/store/useStore';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandBatchPreflightPort,
    commandProjectRevisionPort,
    configureCommandBatchIdempotency,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectIdentity,
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import { readAgentRunState } from '../../stores/agentRunStore';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore, stopGenerating } from '../../stores/chatStore';
import { clearPendingActionConfirmations } from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../../useCases/agentRunLifecycle';
import { confirmPendingChatActions } from '../../useCases/confirmPendingChatActions';
import { sendChatMessage } from '../../useCases/sendChatMessage';
import { ChatComposer } from '../components/ChatComposer';

const providerPlanning = vi.hoisted(() => vi.fn());

vi.mock('../../useCases/llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: vi.fn(() => 'none'),
}));

vi.mock('../../useCases/llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../useCases/llmOrchestration/inference')>()),
    generateToolPlanningOutcome: providerPlanning,
}));

let latestSubmission: Promise<unknown> | null = null;

function ComposerHarness({ mode = 'apply' }: { mode?: 'apply' | 'explain' }): ReactElement {
    const [input, setInput] = useState('');
    const chat = useStore(chatStore, {
        messages: [],
        isGenerating: false,
        enableReasoning: false,
        chatMode: 'chat',
    });
    return (
        <>
            <div aria-label="Rendered conversation">
                {chat?.messages.map((message) => (
                    <p key={message.id}>{message.content}</p>
                ))}
            </div>
            <ChatComposer
                executionMode={mode}
                executionModes={[mode]}
                enableReasoning={false}
                isGenerating={false}
                inputValue={input}
                textareaRef={createRef<HTMLTextAreaElement>()}
                onChange={setInput}
                onKeyDown={() => undefined}
                onExecutionModeChange={() => undefined}
                onToggleReasoning={() => undefined}
                onSend={() => {
                    latestSubmission = sendChatMessage(input, { mode });
                }}
                onStop={stopGenerating}
            />
        </>
    );
}

describe('chat composer without a model backend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        providerPlanning.mockRejectedValue(new Error('Provider planning must not run without a backend.'));
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: {
                request: (_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()),
            },
        });
        latestSubmission = null;
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('chat composer without backend');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getTransportHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        configureCommandBatchIdempotency({ canExecute: () => true });
        commandProjectRevisionPort.setProvider(captureProjectRevision);
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: captureProjectIdentity(),
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            loading: false,
            initialized: true,
        });
        transportStore.set({ ...defaultTransportState, tempo: 120, playheadPosition: 0 });
        tempoMapStore.set({ changes: [] });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: false, chatMode: 'prompt' });
        agentRunLifecycle.clear();
        clearAiHistory();
        clearPendingActionConfirmations();
    });

    afterEach(() => {
        stopGenerating();
        commandBatchPreflightPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        clearPendingActionConfirmations();
        clearAiHistory();
        clearUndoHistory();
        clearHandlerRegistry();
        agentRunLifecycle.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        localStorage.removeItem('sourdaw:command-batch-idempotency:v1');
        vi.unstubAllGlobals();
        Container.clear();
    });

    it('submits a deterministic tempo command through the real planner, command boundary, and undo', async () => {
        render(<ComposerHarness />);

        fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
            target: { value: 'set tempo to 128' },
        });
        fireEvent.click(screen.getAllByRole('button').at(-1)!);
        await act(async () => {
            await latestSubmission;
        });

        const proposedRun = readAgentRunState().runs[0];
        expect(proposedRun).toMatchObject({
            phase: 'waiting-for-approval',
            modelRoute: { selectedRouteId: null },
            providerUsage: [],
        });
        const confirmationId = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationStatus === 'proposed'
        )?.pendingActionConfirmationId;
        if (!confirmationId) {
            throw new Error('Expected the deterministic tempo command to create a real pending confirmation.');
        }
        await act(async () => {
            await expect(confirmPendingChatActions({ confirmationId })).resolves.toEqual({ status: 'executed' });
        });

        const run = readAgentRunState().runs[0];
        expect(run).toMatchObject({
            phase: 'completed',
            modelRoute: { selectedRouteId: null },
            providerUsage: [],
        });
        expect(chatStore.value?.messages).toEqual(
            expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('128') })])
        );
        expect(transportStore.value?.tempo).toBe(128);
        expect(run?.workLeases.some((lease) => lease.ownerKind === 'provider')).toBe(false);
        expect(providerPlanning).not.toHaveBeenCalled();

        await undo();
        expect(transportStore.value?.tempo).toBe(120);
    });

    it('renders actionable model availability for an open-ended request without changing the project', async () => {
        render(<ComposerHarness />);
        const revisionBefore = settlePendingProjectWritesAndCaptureRevision();

        fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
            target: { value: 'make the chorus warmer' },
        });
        fireEvent.click(screen.getAllByRole('button').at(-1)!);
        await act(async () => {
            await latestSubmission;
        });

        expect(
            screen.getByText(
                'No AI backend is available for this request. Configure a hosted provider in the desktop app or use a WebGPU-capable browser.'
            )
        ).toBeInTheDocument();
        expect(captureProjectRevision()).toBe(revisionBefore);
        expect(transportStore.value?.tempo).toBe(120);
        expect(providerPlanning).not.toHaveBeenCalled();
    });

    it('keeps explain model-backed and non-mutating', async () => {
        render(<ComposerHarness mode="explain" />);
        const revisionBefore = settlePendingProjectWritesAndCaptureRevision();

        fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
            target: { value: 'explain the chorus balance' },
        });
        fireEvent.click(screen.getAllByRole('button').at(-1)!);

        await expect(latestSubmission).rejects.toThrow('No AI backend available.');
        expect(captureProjectRevision()).toBe(revisionBefore);
        expect(transportStore.value?.tempo).toBe(120);
        expect(readAgentRunState().runs).toEqual([]);
        expect(providerPlanning).not.toHaveBeenCalled();
    });

    it('cancels local planning before deterministic execution', async () => {
        render(<ComposerHarness />);

        fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
            target: { value: 'set tempo to 128' },
        });
        fireEvent.click(screen.getAllByRole('button').at(-1)!);
        stopGenerating();
        await act(async () => {
            await latestSubmission;
        });

        expect(transportStore.value?.tempo).toBe(120);
        expect(readAgentRunState().runs[0]).toMatchObject({
            phase: 'cancelled',
            cancellation: { generation: 1 },
        });
        expect(providerPlanning).not.toHaveBeenCalled();
    });
});
