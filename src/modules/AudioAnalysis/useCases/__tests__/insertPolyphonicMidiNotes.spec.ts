import { describe, it, expect, vi, beforeEach } from 'vitest';

import { insertPolyphonicMidiNotes } from '../insertPolyphonicMidiNotes';

const mocks = vi.hoisted(() => ({
    getTransportState: vi.fn(),
    getAllTracks: vi.fn(),
    addClip: vi.fn(),
    batchAddMidiNotes: vi.fn(),
    executeAppAction: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: mocks.getAllTracks,
    addClip: mocks.addClip,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    batchAddMidiNotes: mocks.batchAddMidiNotes,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: mocks.getTransportState,
}));

const sourceClip = { startBeat: 0, endBeat: 4, name: 'Vocal' };

describe('insertPolyphonicMidiNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAllTracks.mockReturnValue([]);
        mocks.getTransportState.mockReturnValue({ tempo: 120 });
        mocks.addClip.mockReturnValue({ id: 'midi-clip' });
    });

    it('dispatches an addTrack AppAction (instead of mutating the store) when target is not MIDI', () => {
        const createdTrack = { id: 'midi-created', kind: 'midi', clips: [] };
        // Before dispatch: empty / no matching MIDI track. After dispatch: the new track
        // appears (the addTrack handler mutates the store synchronously inside the dispatch).
        mocks.getAllTracks
            .mockReturnValueOnce([]) // existing-track check
            .mockReturnValueOnce([]) // idsBefore snapshot
            .mockReturnValue([createdTrack]); // post-dispatch reads

        const result = insertPolyphonicMidiNotes([], sourceClip, 'audio-track');

        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'addTrack',
            payload: { name: 'Vocal (MIDI)', kind: 'midi' },
        });
        // The clip is attached to the dispatched track's id — proving the resolved id flows
        // through the command boundary rather than a hidden direct store mutation.
        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'midi-created' }));
        expect(result).toEqual({ clipId: 'midi-clip', trackId: 'midi-created' });
    });

    it('does not dispatch addTrack when the target already is a MIDI track', () => {
        mocks.getAllTracks.mockReturnValue([{ id: 'midi-track', kind: 'midi', clips: [] }]);

        const result = insertPolyphonicMidiNotes([], sourceClip, 'midi-track');

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'midi-track' }));
        expect(result).toEqual({ clipId: 'midi-clip', trackId: 'midi-track' });
    });

    it('returns null when a new MIDI track cannot be created', () => {
        // Dispatch is a no-op (e.g. uninitialised store): no new MIDI track ever appears.
        mocks.getAllTracks.mockReturnValue([]);

        const result = insertPolyphonicMidiNotes([], sourceClip, 'missing-track');

        expect(result).toBeNull();
        expect(mocks.addClip).not.toHaveBeenCalled();
        expect(mocks.batchAddMidiNotes).not.toHaveBeenCalled();
    });
});
