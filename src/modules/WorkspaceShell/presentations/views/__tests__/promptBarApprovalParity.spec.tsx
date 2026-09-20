import { useState } from 'react';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRunStore, pendingActionConfirmationStore } from '#/modules/AiRuntime/stores';
import { submitAdmittedPromptRequest, getAgentApprovalView } from '#/modules/AiRuntime/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { commandBatchPreflightPort, commandProjectRevisionPort } from '#/modules/Command/useCases';
import { captureProjectIdentity, captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { AgentWorkspace } from '../AgentWorkspace';
import { PromptBar } from '../PromptBar';

const execute = vi.hoisted(() => vi.fn(() => ({ status: 'executed' as const })));
vi.mock('#/modules/AiRuntime/useCases/planPromptActions', () => ({
    planPromptActions: vi.fn(async () => {
        const { getProjectContext } = await import('#/modules/AiRuntime/useCases');
        const { captureProjectRevision } = await import('#/modules/CrdtDocument/useCases');
        return {
            context: getProjectContext(),
            result: {
                actions: [{ type: 'setPlayback', payload: { playing: true } }],
                rawText: 'Start playback after review',
                requiresConfirmation: true,
            },
            projectRevision: captureProjectRevision(),
        };
    }),
}));
vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/useCases')>()),
    getAvailablePresets: () => [
        { id: 'review-playback', label: 'Start playback after review', category: 'Transport', isDestructive: true },
    ],
    resolvePresetActions: () => [{ type: 'setPlayback', payload: { playing: true } }],
}));

function Surface({ showPrompt = true }: { showPrompt?: boolean }) {
    const [request, setRequest] = useState<{ runId: string } | null>(null);
    return (
        <>
            {showPrompt ? <PromptBar onReviewRun={(runId) => setRequest({ runId })} /> : null}
            <AgentWorkspace requestedRun={request} />
        </>
    );
}

function submit(route: 'text' | 'preset') {
    const input = screen.getByRole('textbox', { name: 'Prompt command input' });
    if (route === 'preset') {
        fireEvent.focus(input);
        fireEvent.mouseDown(screen.getByRole('option', { name: /Start playback after review/ }));
    } else {
        fireEvent.change(input, { target: { value: 'Start playback after review' } });
        fireEvent.submit(input.closest('form')!);
    }
}

describe('Prompt Bar canonical approval parity', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        agentRunStore.set({ schemaVersion: 1, runs: [] });
        pendingActionConfirmationStore.set({ confirmations: [] });
        clearHandlerRegistry();
        registerHandlerMap({
            setPlayback: {
                executionKind: 'runtime',
                undoable: false,
                validate: () => true,
                describe: () => ({ label: 'Start playback', inverseAction: null }),
                execute,
            },
        });
        commandProjectRevisionPort.setProvider(captureProjectRevision);
        commandBatchPreflightPort.setProvider(() => ({
            projectId: captureProjectIdentity(),
            targetFingerprints: {},
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectInvariantsValid: true,
            audioGraphValid: true,
        }));
        await submitAdmittedPromptRequest({ prompt: 'Previous selected run', source: 'preset', actions: [] });
    });
    afterEach(() => {
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
    });

    it.each(['text', 'preset'] as const)(
        'links the real %s proposal to exact-run approval and shared cancellation',
        async (route) => {
            render(<Surface />);
            expect(
                within(screen.getByRole('region', { name: 'Run summary' })).getByText('Previous selected run')
            ).toBeInTheDocument();
            fireEvent.click(screen.getByRole('option'));
            const before = captureProjectRevision();
            submit(route);
            const review = await screen.findByRole('button', { name: 'Review in Agent' });
            const confirmations = pendingActionConfirmationStore.value?.confirmations ?? [];
            expect(confirmations).toHaveLength(1);
            const confirmation = confirmations[0]!;
            expect(agentRunStore.value?.runs).toHaveLength(2);
            expect(agentRunStore.value?.runs.find((run) => run.runId === confirmation.runId)?.phase).toBe(
                'waiting-for-approval'
            );
            expect(getAgentApprovalView({ confirmationId: confirmation.id })).toMatchObject({
                runId: confirmation.runId,
                freshness: { status: 'current' },
            });
            expect(captureProjectRevision()).toBe(before);
            expect(execute).not.toHaveBeenCalled();
            expect(
                within(screen.getByRole('region', { name: 'Run summary' })).getByText('Previous selected run')
            ).toBeInTheDocument();
            fireEvent.click(review);
            const summary = screen.getByRole('region', { name: 'Run summary' });
            expect(within(summary).getByText('Start playback after review')).toBeInTheDocument();
            await waitFor(() => expect(screen.getByRole('heading', { name: 'Run summary' })).toHaveFocus());
            fireEvent.click(screen.getByRole('button', { name: 'Cancel agent actions' }));
            await waitFor(() =>
                expect(screen.queryByRole('button', { name: 'Review in Agent' })).not.toBeInTheDocument()
            );
            expect(pendingActionConfirmationStore.value?.confirmations[0]?.status).toBe('cancelled');
            expect(execute).not.toHaveBeenCalled();
        }
    );

    it('confirms through the shared owner and clears the compact summary after execution', async () => {
        render(<Surface />);
        submit('text');
        fireEvent.click(await screen.findByRole('button', { name: 'Review in Agent' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm agent actions' }));
        await waitFor(() => expect(pendingActionConfirmationStore.value?.confirmations[0]?.status).toBe('executed'));
        expect(execute).toHaveBeenCalledOnce();
        expect(screen.queryByRole('button', { name: 'Review in Agent' })).not.toBeInTheDocument();
    });

    it('keeps canonical approval alive after Prompt Bar unmount', async () => {
        const rendered = render(<Surface />);
        submit('text');
        await screen.findByRole('button', { name: 'Review in Agent' });
        const confirmation = pendingActionConfirmationStore.value!.confirmations[0]!;
        rendered.rerender(<Surface showPrompt={false} />);
        expect(pendingActionConfirmationStore.value!.confirmations[0]!.status).toBe('proposed');
        expect(agentRunStore.value?.runs.find((run) => run.runId === confirmation.runId)?.phase).toBe(
            'waiting-for-approval'
        );
        await act(async () => {
            const { cancelPendingChatActions } = await import('#/modules/AiRuntime/useCases');
            await cancelPendingChatActions({ confirmationId: confirmation.id });
        });
    });
});
