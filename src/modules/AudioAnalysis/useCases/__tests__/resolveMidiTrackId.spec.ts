import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getAllTracks: vi.fn(),
    executeAppAction: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: mocks.getAllTracks,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

import { resolveMidiTrackId } from '../resolveMidiTrackId';

const audioTrack = { id: 'track-1', kind: 'audio', devices: [] };
const midiTrack = { id: 'track-1', kind: 'midi', devices: [] };
const newMidiTrack = { id: 'track-2', kind: 'midi', devices: [] };

describe('resolveMidiTrackId', () => {
    it('returns the targetTrackId unchanged when it is already a MIDI track', () => {
        mocks.getAllTracks.mockReturnValue([midiTrack]);

        const result = resolveMidiTrackId('track-1', 'New Track');

        expect(result).toBe('track-1');
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    it('creates a new MIDI track via executeAppAction when target is audio kind and returns the new id', () => {
        mocks.getAllTracks
            .mockReturnValueOnce([audioTrack]) // existingTrack lookup
            .mockReturnValueOnce([audioTrack]) // idsBefore snapshot
            .mockReturnValueOnce([audioTrack, newMidiTrack]); // after creation

        const result = resolveMidiTrackId('track-1', 'Converted MIDI');

        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'addTrack',
            payload: { name: 'Converted MIDI', kind: 'midi' },
        });
        expect(result).toBe('track-2');
    });

    it('creates a MIDI track when targetTrackId does not exist in the project', () => {
        mocks.getAllTracks
            .mockReturnValueOnce([audioTrack]) // existingTrack lookup: not found
            .mockReturnValueOnce([audioTrack]) // idsBefore
            .mockReturnValueOnce([audioTrack, newMidiTrack]); // after creation

        const result = resolveMidiTrackId('nonexistent', 'New MIDI');

        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'addTrack',
            payload: { name: 'New MIDI', kind: 'midi' },
        });
        expect(result).toBe('track-2');
    });

    it('returns null when addTrack does not create a MIDI track', () => {
        const newAudioTrack = { id: 'track-2', kind: 'audio', devices: [] };
        mocks.getAllTracks
            .mockReturnValueOnce([audioTrack])
            .mockReturnValueOnce([audioTrack])
            .mockReturnValueOnce([audioTrack, newAudioTrack]);

        const result = resolveMidiTrackId('track-1', 'Failed');

        expect(result).toBeNull();
    });
});
