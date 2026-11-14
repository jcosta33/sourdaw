import { act, cleanup, fireEvent, render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeAppAction, executeAppActionBatch } from '#/modules/Command/useCases';
import { captureProjectRevision, subscribeToCrdtChanges } from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { measuredPreviewAuditionStore } from '../../stores/measuredPreviewAuditionStore';
import {
    clearPendingActionConfirmations,
    proposePendingActionConfirmation,
    updatePendingActionConfirmationStatus,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../../useCases/agentRunLifecycle';
import { agentRunCancellation } from '../../useCases/cancelAgentRun';
import { cancelPendingChatActions } from '../../useCases/cancelPendingChatActions';
import { confirmPendingChatActions } from '../../useCases/confirmPendingChatActions';
import { reproposePendingChatActions } from '../../useCases/reproposePendingChatActions';
import { skipPendingVibeBatch } from '../../useCases/skipPendingVibeBatch';
import { stopMeasuredPreviewAudition } from '../../useCases/stopMeasuredPreviewAudition';
import { MeasuredPreviewAudition } from '../views/MeasuredPreviewAudition';

/**
 * The real audition owner (start, stop, runtime and store) behind both surfaces that mount the shared
 * comparison. Only the AudioEngine's exclusive source executor is doubled, and the retained pair stands
 * in for the receipt-backed resolver whose proof checks `previewMeasurement.spec.ts` covers: it keeps
 * that resolver's first gate, a proposal still awaiting approval on a live run.
 */
const audio = vi.hoisted(() => ({
    play: vi.fn(),
    handles: [] as Array<{ buffer: unknown; gain: number; stop: ReturnType<typeof vi.fn> }>,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    playExclusiveAudioBufferPreview: audio.play,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        executeAppAction: vi.fn(actual.executeAppAction),
        executeAppActionBatch: vi.fn(actual.executeAppActionBatch),
    };
});

const PCM = vi.hoisted(() => ({ baseline: { pcm: 'baseline' }, preview: { pcm: 'preview' } }));

vi.mock('../../useCases/resolveMeasuredPreviewAudition', async () => {
    const { getPendingActionConfirmation } = await import('../../stores/pendingActionConfirmationStore');
    const { agentRunLifecycle: lifecycle } = await import('../../useCases/agentRunLifecycle');
    const terminal = new Set(['completed', 'failed', 'cancelled', 'partially-completed']);
    return {
        resolveMeasuredPreviewAudition: (input: { confirmationId: string; targetId: string }) => {
            const confirmation = getPendingActionConfirmation(input.confirmationId);
            const run = confirmation === null ? null : lifecycle.get(confirmation.runId);
            if (
                confirmation === null ||
                confirmation.status !== 'proposed' ||
                confirmation.supersededBy !== null ||
                run === null ||
                terminal.has(run.phase)
            ) {
                return { status: 'unavailable', reason: 'This proposal is no longer awaiting approval.' };
            }
            return {
                status: 'available',
                identity: `${input.confirmationId}:${input.targetId}`,
                revision: confirmation.projectRevision,
                targetId: input.targetId,
                baseline: { buffer: PCM.baseline, gain: 0.5, lufs: -10 },
                preview: { buffer: PCM.preview, gain: 1, lufs: -16 },
                matchLufs: -16,
            };
        },
    };
});

// The musician-facing projection over the same pair and the real audition store.
vi.mock('../../useCases/getMeasuredPreviewAuditionView', async () => {
    const { measuredPreviewAuditionStore: store } = await import('../../stores/measuredPreviewAuditionStore');
    const { resolveMeasuredPreviewAudition } = await import('../../useCases/resolveMeasuredPreviewAudition');
    function readTarget(pair: ReturnType<typeof resolveMeasuredPreviewAudition>) {
        if (pair.status !== 'available') {
            return { targetId: 'drums', targetName: 'Drums', available: false as const, reason: pair.reason };
        }
        return {
            targetId: 'drums',
            targetName: 'Drums',
            available: true as const,
            reason: null,
            baselineLufs: pair.baseline.lufs,
            proposalLufs: pair.preview.lufs,
            matchedLufs: pair.matchLufs,
        };
    }
    return {
        getMeasuredPreviewAuditionView: (input: { confirmationId: string }) => {
            const pair = resolveMeasuredPreviewAudition({ confirmationId: input.confirmationId, targetId: 'drums' });
            const target = readTarget(pair);
            const state = store.value;
            const active = state?.confirmationId === input.confirmationId ? state : null;
            return {
                confirmationId: input.confirmationId,
                targets: [target],
                phase: active?.phase ?? 'idle',
                side: active?.side ?? null,
                targetId: active?.targetId ?? null,
                error: active?.error ?? null,
                reason: null,
            };
        },
    };
});

const GROUPS = ['gain', 'trim'];

function propose(confirmationId: string, runId: string): void {
    agentRunLifecycle.create({
        runId,
        request: 'Make the drums punchier',
        mode: 'apply',
        createdRevision: 'audition-revision',
        createdAt: 1,
    });
    agentRunLifecycle.transitionPhase({
        runId,
        phase: 'planning',
        revision: 'audition-revision',
        transitionedAt: 2,
    });
    proposePendingActionConfirmation({
        id: confirmationId,
        runId,
        prompt: 'Make the drums punchier',
        assistantMessageId: `${confirmationId}-message`,
        actions: [],
        actionLabels: ['Adjust gain'],
        projectRevision: 'audition-revision',
    });
}

function mount(confirmationId: string, surface: 'chat' | 'agent-workspace'): RenderResult {
    return render(
        <MeasuredPreviewAudition confirmationId={confirmationId} selectedIntentGroupIds={GROUPS} surface={surface} />
    );
}

function comparison(view: RenderResult): HTMLElement {
    return within(view.container).getByRole('region', { name: 'Measured audio comparison' });
}

/** Press one side and wait until the real store says that operation is the one playing. */
async function play(view: RenderResult, side: 'Baseline' | 'Proposal'): Promise<void> {
    const calls = audio.play.mock.calls.length;
    fireEvent.click(within(comparison(view)).getByRole('button', { name: side }));
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(calls + 1));
    const confirmationId = comparison(view).getAttribute('data-confirmation-id');
    await waitFor(() => expect(measuredPreviewAuditionStore.value).toMatchObject({ phase: 'playing', confirmationId }));
}

function setTransportPlaying(isPlaying: boolean): void {
    const current = transportStore.value;
    if (current === null) {
        throw new Error('The transport store has no state.');
    }
    act(() => {
        transportStore.set({ ...current, isPlaying });
    });
}

async function expectStopped(handleIndex: number): Promise<void> {
    await waitFor(() => expect(measuredPreviewAuditionStore.value?.phase).toBe('idle'));
    expect(audio.handles[handleIndex]?.stop).toHaveBeenCalledTimes(1);
}

describe('one measured audition owner behind the chat card and the Agent Workspace', () => {
    beforeEach(() => {
        audio.handles = [];
        audio.play.mockReset();
        audio.play.mockImplementation((input: { buffer: unknown; gain: number }) => {
            const stop = vi.fn(async () => undefined);
            audio.handles.push({ buffer: input.buffer, gain: input.gain, stop });
            return { ready: Promise.resolve(), stop };
        });
        vi.mocked(executeAppAction).mockClear();
        vi.mocked(executeAppActionBatch).mockClear();
        setTransportPlaying(false);
        propose('pending-a', 'run-a');
    });

    afterEach(async () => {
        cleanup();
        await stopMeasuredPreviewAudition();
        clearPendingActionConfirmations();
        agentRunLifecycle.clear();
        setTransportPlaying(false);
    });

    it('plays the same loudness-matched material from either surface', async () => {
        const chat = mount('pending-a', 'chat');
        const workspace = mount('pending-a', 'agent-workspace');
        for (const view of [chat, workspace]) {
            expect(within(comparison(view)).getByText('Loudness matched at -16.0 LUFS')).toBeVisible();
            for (const name of ['Baseline', 'Proposal', 'Stop comparison']) {
                expect(within(comparison(view)).getByRole('button', { name })).toBeInTheDocument();
            }
        }

        await play(chat, 'Proposal');
        await play(workspace, 'Proposal');
        await play(chat, 'Baseline');

        expect(audio.handles.map(({ buffer, gain }) => ({ buffer, gain }))).toEqual([
            { buffer: PCM.preview, gain: 1 },
            { buffer: PCM.preview, gain: 1 },
            { buffer: PCM.baseline, gain: 0.5 },
        ]);
        // Both surfaces project the one operation, so each shows the side now playing.
        for (const view of [chat, workspace]) {
            expect(within(comparison(view)).getByRole('status')).toHaveTextContent('Playing baseline');
        }
    });

    it('keeps one audition playing across chat, Workspace and a second chat card', async () => {
        propose('pending-b', 'run-b');
        const chat = mount('pending-a', 'chat');
        const workspace = mount('pending-a', 'agent-workspace');
        const secondChat = mount('pending-b', 'chat');

        await play(workspace, 'Proposal');
        await play(chat, 'Proposal');
        expect(audio.handles[0]?.stop).toHaveBeenCalledTimes(1);

        await play(workspace, 'Baseline');
        expect(audio.handles[1]?.stop).toHaveBeenCalledTimes(1);

        await play(chat, 'Baseline');
        await play(secondChat, 'Proposal');
        expect(audio.handles[3]?.stop).toHaveBeenCalledTimes(1);
        expect(audio.handles[4]?.stop).not.toHaveBeenCalled();
        expect(measuredPreviewAuditionStore.value).toMatchObject({ confirmationId: 'pending-b', phase: 'playing' });
    });

    it.each([
        { route: 'Confirm', settle: () => confirmPendingChatActions({ confirmationId: 'pending-a' }) },
        { route: 'Skip batch', settle: () => skipPendingVibeBatch({ confirmationId: 'pending-a' }) },
        { route: 'Cancel', settle: () => cancelPendingChatActions({ confirmationId: 'pending-a' }) },
        { route: 'Re-preview', settle: () => reproposePendingChatActions({ confirmationId: 'pending-a' }) },
        {
            route: 'a refused proposal',
            settle: () =>
                updatePendingActionConfirmationStatus({
                    confirmationId: 'pending-a',
                    status: 'invalidated',
                    error: 'The project changed before Confirm.',
                }),
        },
        {
            route: 'Stop run',
            settle: () => agentRunCancellation.cancel({ runId: 'run-a', reason: 'Cancelled by user' }),
        },
    ])('ends a chat-started audition through $route', async ({ settle }) => {
        const chat = mount('pending-a', 'chat');
        await play(chat, 'Proposal');

        await settle();

        await expectStopped(0);
    });

    it('stops on unmount only the audition its own surface started', async () => {
        const chat = mount('pending-a', 'chat');
        const workspace = mount('pending-a', 'agent-workspace');

        await play(workspace, 'Proposal');
        chat.unmount();
        expect(audio.handles[0]?.stop).not.toHaveBeenCalled();
        expect(measuredPreviewAuditionStore.value).toMatchObject({ phase: 'playing', confirmationId: 'pending-a' });

        const reopenedChat = mount('pending-a', 'chat');
        await play(reopenedChat, 'Baseline');
        // Closing the chat panel unmounts its cards: AppShell renders no closed side panel.
        reopenedChat.unmount();
        await expectStopped(1);

        await play(workspace, 'Proposal');
        workspace.unmount();
        await expectStopped(2);
    });

    it('yields the output to transport playback that starts during the audition', async () => {
        const chat = mount('pending-a', 'chat');
        await play(chat, 'Proposal');

        setTransportPlaying(true);

        await expectStopped(0);
        expect(transportStore.value?.isPlaying).toBe(true);
        expect(executeAppAction).not.toHaveBeenCalled();
        expect(executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('keeps an audition started over a playing transport until playback starts again', async () => {
        setTransportPlaying(true);
        const chat = mount('pending-a', 'chat');
        await play(chat, 'Proposal');

        setTransportPlaying(true);
        setTransportPlaying(false);
        expect(audio.handles[0]?.stop).not.toHaveBeenCalled();
        expect(measuredPreviewAuditionStore.value?.phase).toBe('playing');

        setTransportPlaying(true);
        await expectStopped(0);
        expect(executeAppAction).not.toHaveBeenCalled();
    });

    it('writes nothing to the project while comparing', async () => {
        const revision = captureProjectRevision();
        const changes = vi.fn();
        const unsubscribe = subscribeToCrdtChanges(changes);
        try {
            const chat = mount('pending-a', 'chat');
            await play(chat, 'Baseline');
            await play(chat, 'Proposal');
            fireEvent.click(within(comparison(chat)).getByRole('button', { name: 'Stop comparison' }));
            await expectStopped(1);
        } finally {
            unsubscribe();
        }
        expect(changes).not.toHaveBeenCalled();
        expect(captureProjectRevision()).toBe(revision);
        expect(executeAppAction).not.toHaveBeenCalled();
        expect(executeAppActionBatch).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Stopped');
    });
});
