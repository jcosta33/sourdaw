import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    addMidiNote: vi.fn(),
}));

import { addMidiNote } from '#/modules/MIDI/useCases';

import { handleAddNotes } from '../handleAddNotes';

const mockedAdd = vi.mocked(addMidiNote);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleAddNotes — execute guards', () => {
    it('does nothing when notes is empty array', () => {
        handleAddNotes.execute({ type: 'addNotes', payload: { clipId: 'c1', notes: [] } });
        expect(mockedAdd).not.toHaveBeenCalled();
    });

    it('does nothing when notes is not an array', () => {
        handleAddNotes.execute({ type: 'addNotes', payload: { clipId: 'c1', notes: null as never } });
        expect(mockedAdd).not.toHaveBeenCalled();
    });

    it('skips notes with NaN pitch', () => {
        handleAddNotes.execute({
            type: 'addNotes',
            payload: { clipId: 'c1', notes: [{ pitch: Number.NaN, startBeat: 0, duration: 1 }] },
        });
        expect(mockedAdd).not.toHaveBeenCalled();
    });

    it('skips notes with non-finite duration', () => {
        handleAddNotes.execute({
            type: 'addNotes',
            payload: { clipId: 'c1', notes: [{ pitch: 60, startBeat: 0, duration: Number.POSITIVE_INFINITY }] },
        });
        expect(mockedAdd).not.toHaveBeenCalled();
    });
});

describe('handleAddNotes — clamping', () => {
    it('clamps pitch to 0-127', () => {
        handleAddNotes.execute({
            type: 'addNotes',
            payload: { clipId: 'c1', notes: [{ pitch: 200, startBeat: 0, duration: 1 }] },
        });
        expect(mockedAdd).toHaveBeenCalledWith('c1', 127, 0, 1, 100);
    });

    it('clamps negative pitch to 0', () => {
        handleAddNotes.execute({
            type: 'addNotes',
            payload: { clipId: 'c1', notes: [{ pitch: -5, startBeat: 0, duration: 1 }] },
        });
        expect(mockedAdd).toHaveBeenCalledWith('c1', 0, 0, 1, 100);
    });

    it('floors duration at 0.0625', () => {
        handleAddNotes.execute({
            type: 'addNotes',
            payload: { clipId: 'c1', notes: [{ pitch: 60, startBeat: 0, duration: 0.01 }] },
        });
        expect(mockedAdd).toHaveBeenCalledWith('c1', 60, 0, 0.0625, 100);
    });

    it('clamps velocity to 1-127', () => {
        handleAddNotes.execute({
            type: 'addNotes',
            payload: { clipId: 'c1', notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 0 }] },
        });
        expect(mockedAdd).toHaveBeenCalledWith('c1', 60, 0, 1, 1);
    });

    it('defaults velocity to 100 when omitted', () => {
        handleAddNotes.execute({
            type: 'addNotes',
            payload: { clipId: 'c1', notes: [{ pitch: 60, startBeat: 0, duration: 1 }] },
        });
        expect(mockedAdd).toHaveBeenCalledWith('c1', 60, 0, 1, 100);
    });
});

describe('handleAddNotes — multiple notes', () => {
    it('processes valid notes and skips invalid ones', () => {
        handleAddNotes.execute({
            type: 'addNotes',
            payload: {
                clipId: 'c1',
                notes: [
                    { pitch: 60, startBeat: 0, duration: 1 },
                    { pitch: Number.NaN, startBeat: 0, duration: 1 },
                    { pitch: 64, startBeat: 2, duration: 0.5, velocity: 80 },
                ],
            },
        });
        expect(mockedAdd).toHaveBeenCalledTimes(2);
        expect(mockedAdd).toHaveBeenNthCalledWith(1, 'c1', 60, 0, 1, 100);
        expect(mockedAdd).toHaveBeenNthCalledWith(2, 'c1', 64, 2, 0.5, 80);
    });
});

describe('handleAddNotes — describe', () => {
    it('returns label with note count', () => {
        const result = handleAddNotes.describe({
            type: 'addNotes',
            payload: { clipId: 'c1', notes: [{ pitch: 60, startBeat: 0, duration: 1 }] },
        });
        expect(result.label).toBe('Add 1 MIDI notes');
    });
});
