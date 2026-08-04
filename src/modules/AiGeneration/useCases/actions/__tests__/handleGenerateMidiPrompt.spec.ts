import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleGenerateMidiPrompt } from '../handleGenerateMidiPrompt';

type TaskPatch = {
    status: string;
    error?: string;
    data?: { noteCount?: number; warning?: string };
    durationMs?: number;
};

const mocks = vi.hoisted(() => ({
    captureProjectRevision: vi.fn(() => 'revision-1'),
    executeAppActionBatch: vi.fn(),
    generateMidiViaLlm: vi.fn(),
    getAiSnapshot: vi.fn(),
    getNotesForClip: vi.fn<
        () => Array<{ id: string; pitch: number; startBeat: number; duration: number; velocity: number }>
    >(() => []),
    getTrackStoreState: vi.fn(),
    getTransportState: vi.fn(() => ({ playheadPosition: 8 })),
    notifyUser: vi.fn(),
    selectClip: vi.fn(),
    updateTask: vi.fn<(taskId: string, patch: TaskPatch) => void>(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getTrackStoreState: mocks.getTrackStoreState,
    selectClip: mocks.selectClip,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppActionBatch: mocks.executeAppActionBatch,
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    captureProjectRevision: mocks.captureProjectRevision,
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    getNotesForClip: mocks.getNotesForClip,
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    getTransportState: mocks.getTransportState,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('../../../stores/aiStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../stores/aiStore')>()),
    getAiSnapshot: mocks.getAiSnapshot,
}));

vi.mock('../../llmMidiGeneration', () => ({
    generateMidiViaLlm: mocks.generateMidiViaLlm,
}));

vi.mock('../addTask', () => ({
    addTask: vi.fn(() => 'task-1'),
}));

vi.mock('../updateTask', () => ({
    updateTask: mocks.updateTask,
}));

const generatedNotes = [{ pitch: 60, start_beat: 0, duration_beats: 1, velocity: 100 }];

describe('handleGenerateMidiPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.captureProjectRevision.mockReturnValue('revision-1');
        mocks.getAiSnapshot.mockReturnValue({
            tasks: [{ id: 'task-1', type: 'midi-generation', status: 'processing', timestamp: 1 }],
            isPanelOpen: true,
        });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [], selectedTrackId: null });
        mocks.generateMidiViaLlm.mockResolvedValue(generatedNotes);
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'committed', actions: [] });
    });

    it('writes provider-neutral output as one compensable AppAction batch', async () => {
        await handleGenerateMidiPrompt('a melody');

        expect(mocks.generateMidiViaLlm).toHaveBeenCalledWith('a melody', 32, 0.65);
        const [actions, options] = mocks.executeAppActionBatch.mock.calls[0] as [
            Array<{ type: string; payload: Record<string, unknown> }>,
            { source: string; requireCompensation: boolean; shouldExecute: () => boolean },
        ];
        expect(actions.map((action) => action.type)).toEqual(['addTrack', 'addClip', 'addNotes']);
        const addTrack = actions[0];
        const addClip = actions[1];
        const addNotes = actions[2];
        expect(addTrack?.payload.id).toBe(addClip?.payload.trackId);
        expect(addClip?.payload.id).toBe(addNotes?.payload.clipId);
        expect(addClip?.payload).toMatchObject({ startBeat: 8, endBeat: 9, type: 'midi' });
        expect(addNotes?.payload.notes).toEqual([{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }]);
        expect(options).toMatchObject({ source: 'ai', requireCompensation: true, skipMacroRecording: true });
        expect(options.shouldExecute()).toBe(true);
        expect(mocks.selectClip).toHaveBeenCalledWith(addClip?.payload.id);
        expect(mocks.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ status: 'success' }));
    });

    it('uses the selected MIDI track without creating another track', async () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'midi-1', kind: 'midi', clips: [] }],
            selectedTrackId: 'midi-1',
        });

        await handleGenerateMidiPrompt('bass');

        const actions = mocks.executeAppActionBatch.mock.calls[0]?.[0] as Array<{
            type: string;
            payload: Record<string, unknown>;
        }>;
        expect(actions.map((action) => action.type)).toEqual(['addClip', 'addNotes']);
        expect(actions[0]?.payload.trackId).toBe('midi-1');
    });

    it('does not write or overwrite the stopped status when cancellation wins inference', async () => {
        mocks.generateMidiViaLlm.mockImplementation(() => {
            mocks.getAiSnapshot.mockReturnValue({
                tasks: [{ id: 'task-1', type: 'midi-generation', status: 'error', timestamp: 1 }],
                isPanelOpen: true,
            });
            return Promise.resolve(generatedNotes);
        });

        await handleGenerateMidiPrompt('cancel me');

        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.updateTask).not.toHaveBeenCalled();
    });

    it('reports a durable commit truthfully when stop arrives while committed effects settle', async () => {
        mocks.executeAppActionBatch.mockImplementation(() => {
            mocks.getAiSnapshot.mockReturnValue({
                tasks: [{ id: 'task-1', type: 'midi-generation', status: 'error', timestamp: 1 }],
                isPanelOpen: true,
            });
            return Promise.resolve({ status: 'committed' as const, actions: [] });
        });

        await handleGenerateMidiPrompt('late stop');

        expect(mocks.selectClip).toHaveBeenCalledOnce();
        expect(mocks.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ status: 'success' }));
    });

    it('surfaces a durable ambiguous commit as success with a runtime warning', async () => {
        mocks.executeAppActionBatch.mockImplementation((actions: Array<{ payload?: Record<string, unknown> }>) => {
            const clipId = actions[1]?.payload?.id;
            if (typeof clipId !== 'string') {
                throw new TypeError('Expected generated clip identity');
            }
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 'track-ai', clips: [{ id: clipId }] }],
                selectedTrackId: null,
            });
            mocks.getNotesForClip.mockReturnValue([
                { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
            ]);
            return Promise.resolve({
                status: 'ambiguous' as const,
                reason: 'runtime reconciliation failed: track.added event unavailable',
                actions: [],
            });
        });

        await handleGenerateMidiPrompt('ambiguous melody');

        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'MIDI generation committed with a warning: runtime reconciliation failed: track.added event unavailable',
            'warning'
        );
        const taskUpdate = mocks.updateTask.mock.calls.find(([taskId]) => taskId === 'task-1')?.[1];
        expect(taskUpdate?.status).toBe('success');
        expect(taskUpdate?.data?.warning).toBe('runtime reconciliation failed: track.added event unavailable');
    });

    it('reports stale project authority without applying any actions', async () => {
        mocks.executeAppActionBatch.mockImplementation((_actions, options: { shouldExecute?: () => boolean }) => {
            mocks.captureProjectRevision.mockReturnValue('revision-2');
            return Promise.resolve(
                options.shouldExecute?.()
                    ? { status: 'committed' as const, actions: [] }
                    : { status: 'cancelled' as const, reason: 'revoked', actions: [] }
            );
        });

        await handleGenerateMidiPrompt('stale melody');

        expect(mocks.selectClip).not.toHaveBeenCalled();
        expect(mocks.updateTask).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
                error: 'MIDI generation was cancelled because the project changed while AI was working.',
            })
        );
    });

    it('records an error without dispatch when generation yields no notes', async () => {
        mocks.generateMidiViaLlm.mockResolvedValue([]);

        await handleGenerateMidiPrompt('empty');

        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.updateTask).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({ status: 'error', error: 'No notes generated — try rephrasing the prompt' })
        );
    });
});
