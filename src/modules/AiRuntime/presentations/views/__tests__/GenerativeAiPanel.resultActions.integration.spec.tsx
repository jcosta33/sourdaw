import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { aiStore, type AiTaskResult } from '#/modules/AiGeneration/stores';

import { GenerativeAiPanel } from '../GenerativeAiPanel';

const mocks = vi.hoisted(() => ({
    getNotesForClip: vi.fn<
        () => Array<{ id: string; pitch: number; startBeat: number; duration: number; velocity: number }>
    >(() => []),
    getTrackStoreState: vi.fn<
        () => {
            tracks: Array<{ id: string; kind: string; clips: Array<{ id: string }> }>;
            selectedTrackId: string | null;
        }
    >(() => ({ tracks: [], selectedTrackId: null })),
    getTransportState: vi.fn(() => ({ tempo: 120, playheadPosition: 0 })),
    notifyUser: vi.fn(),
    playAuditionNote: vi.fn(),
    selectClip: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getTrackStoreState: mocks.getTrackStoreState,
    selectClip: mocks.selectClip,
}));

// Spreads the real barrel (which the panel's other imports already load) and
// replaces only the audition use case, so the assertions observe the seam the
// piano roll also drives.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    playAuditionNote: mocks.playAuditionNote,
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

// Two notes: one on beat 0, one on beat 2. At 120 BPM a beat is 500 ms.
const clipNotes = [
    { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
    { id: 'n2', pitch: 64, startBeat: 2, duration: 1, velocity: 80 },
];

function committedTask(overrides: Partial<AiTaskResult> = {}): AiTaskResult {
    return {
        id: 'midi-1',
        type: 'midi-generation',
        status: 'success',
        timestamp: Date.now(),
        durationMs: 1200,
        data: { noteCount: 2, clipId: 'clip-1', trackId: 'track-1' },
        ...overrides,
    };
}

function seedTasks(tasks: AiTaskResult[]): void {
    aiStore.set({ isPanelOpen: true, tasks });
}

describe('GenerativeAiPanel — result card clip actions (integration)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        seedTasks([]);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-1', kind: 'midi', clips: [] }],
            selectedTrackId: null,
        });
        mocks.getTransportState.mockReturnValue({ tempo: 120, playheadPosition: 0 });
        mocks.getNotesForClip.mockReturnValue(clipNotes);
        mocks.playAuditionNote.mockImplementation(() => vi.fn());
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('auditions the committed generated clip through the real audition use case', () => {
        seedTasks([committedTask()]);
        render(<GenerativeAiPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Preview task result' }));

        expect(mocks.getNotesForClip).toHaveBeenCalledWith('clip-1');
        act(() => {
            vi.advanceTimersByTime(0);
        });
        expect(mocks.playAuditionNote).toHaveBeenNthCalledWith(1, 'track-1', 60, 100);
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(mocks.playAuditionNote).toHaveBeenNthCalledWith(2, 'track-1', 64, 80);
    });

    it('offers no Apply affordance for already-committed material', () => {
        seedTasks([committedTask()]);
        render(<GenerativeAiPanel />);

        expect(screen.getByRole('button', { name: 'Preview task result' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Add task result to arrangement' })).toBeNull();
        expect(screen.queryByTitle('Add to arrangement')).toBeNull();
    });

    it('re-selects the committed clip from the select affordance', () => {
        seedTasks([committedTask()]);
        render(<GenerativeAiPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Select generated clip' }));

        expect(mocks.selectClip).toHaveBeenCalledWith('clip-1');
    });

    it('stops a sounding audition when preview is toggled off', () => {
        const stopFirstNote = vi.fn();
        mocks.playAuditionNote.mockImplementation(() => stopFirstNote);
        seedTasks([committedTask()]);
        render(<GenerativeAiPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Preview task result' }));
        act(() => {
            vi.advanceTimersByTime(0);
        });
        fireEvent.click(screen.getByRole('button', { name: 'Stop clip preview' }));

        expect(stopFirstNote).toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Preview task result' })).toBeTruthy();
    });

    it('ends the audition after the clip tail without leaving a stop control', () => {
        seedTasks([committedTask()]);
        render(<GenerativeAiPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Preview task result' }));
        // Clip ends at (2 + 1) beats = 1500 ms at 120 BPM.
        act(() => {
            vi.advanceTimersByTime(1500);
        });

        expect(screen.getByRole('button', { name: 'Preview task result' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Stop clip preview' })).toBeNull();
    });

    it('does not audition or enter playing state when the generated clip is gone', () => {
        mocks.getNotesForClip.mockReturnValue([]);
        seedTasks([committedTask()]);
        render(<GenerativeAiPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Preview task result' }));
        act(() => {
            vi.advanceTimersByTime(2000);
        });

        expect(mocks.notifyUser).toHaveBeenCalledWith('The generated clip is no longer in the project', 'info');
        expect(mocks.playAuditionNote).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Preview task result' })).toBeTruthy();
    });

    it('renders no enabled actions for a legacy task without clip identity', () => {
        seedTasks([committedTask({ data: { noteCount: 3, warning: 'late write' } })]);
        render(<GenerativeAiPanel />);

        expect(screen.getByText('1.2s')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Preview task result' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Stop clip preview' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Select generated clip' })).toBeNull();
    });

    it('renders no enabled actions when the payload carries a partial identity', () => {
        seedTasks([committedTask({ data: { noteCount: 3, clipId: 'clip-1' } })]);
        render(<GenerativeAiPanel />);

        expect(screen.queryByRole('button', { name: 'Preview task result' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Select generated clip' })).toBeNull();
    });

    it('renders no clip actions for non-MIDI task types', () => {
        seedTasks([
            {
                id: 'denoise-1',
                type: 'denoise',
                status: 'success',
                timestamp: Date.now(),
                durationMs: 900,
                data: { clipId: 'source-clip', noiseFloorDb: -40 },
            },
        ]);
        render(<GenerativeAiPanel />);

        expect(screen.getByText('0.9s')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Preview task result' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Select generated clip' })).toBeNull();
    });
});
