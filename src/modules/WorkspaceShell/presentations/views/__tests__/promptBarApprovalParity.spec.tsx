import { useState } from 'react';

import { act, fireEvent, render, cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { agentRunStore, pendingActionConfirmationStore } from '#/modules/AiRuntime/stores';
import { submitAdmittedPromptRequest, getAgentApprovalView } from '#/modules/AiRuntime/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import {
    addTrack,
    getArrangementHandlers,
    resetArrangementStoresForProject,
    setArrangementEventBus,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    commandBatchPreflightPort,
    commandProjectRevisionPort,
    configureCommandBatchIdempotency,
    resetActionReplayAuthority,
    resetCommandBatchIdempotency,
} from '#/modules/Command/useCases';
import {
    captureProjectIdentity,
    captureProjectRevision,
    createCrdtDoc,
    removeCrdtDoc,
    registerCrdtStorageRuntime,
    resetCrdtProjectAuthority,
    projectRevisionMatchesLiveIgnoringCommandCheckpoint,
} from '#/modules/CrdtDocument/useCases';

import { AgentWorkspace } from '../AgentWorkspace';
import { PromptBar } from '../PromptBar';

const handlers = getArrangementHandlers();

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
        fireEvent.change(input, { target: { value: 'Delete Track' } });
        fireEvent.mouseDown(screen.getByRole('option', { name: /Delete Track/ }));
    } else {
        fireEvent.change(input, { target: { value: 'Delete Track' } });
        fireEvent.submit(input.closest('form')!);
    }
}

describe('Prompt Bar canonical approval parity', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: { request: (_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()) },
        });
        agentRunStore.set({ schemaVersion: 1, runs: [] });
        pendingActionConfirmationStore.set({ confirmations: [] });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Prompt Bar approval parity');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        resetArrangementStoresForProject();
        setArrangementEventBus({ emit: async () => undefined });
        expect(
            addTrack({ id: 'review-track', name: 'Review track', kind: 'audio', suppressAddedEvent: true })
        ).not.toBeNull();
        flushAutomergeStorageWrites();
        resetActionReplayAuthority();
        configureCommandBatchIdempotency({ canExecute: () => true });
        clearHandlerRegistry();
        vi.spyOn(handlers.removeTrack, 'execute');
        registerHandlerMap(handlers);
        commandProjectRevisionPort.setProvider(captureProjectRevision);
        commandProjectRevisionPort.setLiveMatchIgnoringCommandCheckpoint(
            projectRevisionMatchesLiveIgnoringCommandCheckpoint
        );
        commandBatchPreflightPort.setProvider(() => ({
            projectId: captureProjectIdentity(),
            targetFingerprints: { 'review-track': 'review-track' },
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectInvariantsValid: true,
            audioGraphValid: true,
        }));
        await submitAdmittedPromptRequest({ prompt: 'Previous selected run', source: 'preset', actions: [] });
    });
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        resetCommandBatchIdempotency();
        vi.unstubAllGlobals();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        resetArrangementStoresForProject();
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
            expect(trackStore.value?.tracks.map((track) => track.id)).toEqual(['review-track']);
            expect(handlers.removeTrack.execute).not.toHaveBeenCalled();
            expect(
                within(screen.getByRole('region', { name: 'Run summary' })).getByText('Previous selected run')
            ).toBeInTheDocument();
            fireEvent.click(review);
            const summary = screen.getByRole('region', { name: 'Run summary' });
            expect(within(summary).getByText('Delete Track')).toBeInTheDocument();
            await waitFor(() => expect(screen.getByRole('heading', { name: 'Run summary' })).toHaveFocus());
            fireEvent.click(screen.getByRole('button', { name: 'Cancel agent actions' }));
            await waitFor(() =>
                expect(screen.queryByRole('button', { name: 'Review in Agent' })).not.toBeInTheDocument()
            );
            expect(pendingActionConfirmationStore.value?.confirmations[0]?.status).toBe('cancelled');
            expect(handlers.removeTrack.execute).not.toHaveBeenCalled();
        }
    );

    it('confirms through the shared owner and clears the compact summary after execution', async () => {
        render(<Surface />);
        submit('text');
        fireEvent.click(await screen.findByRole('button', { name: 'Review in Agent' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm agent actions' }));
        await waitFor(() =>
            expect(['proposed', 'accepted']).not.toContain(
                pendingActionConfirmationStore.value?.confirmations[0]?.status
            )
        );
        const confirmation = pendingActionConfirmationStore.value?.confirmations[0];
        expect({ status: confirmation?.status, error: confirmation?.error }).toEqual({
            status: 'executed',
            error: null,
        });
        expect(handlers.removeTrack.execute).toHaveBeenCalledOnce();
        expect(trackStore.value?.tracks).toEqual([]);
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
        expect(pendingActionConfirmationStore.value!.confirmations[0]!.status).toBe('cancelled');
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual(['review-track']);
        expect(handlers.removeTrack.execute).not.toHaveBeenCalled();
    });
});
