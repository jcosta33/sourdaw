import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveOrCreateMidiTrack, getPlayheadBeat } from '../generationHandlerHelpers';

const mocks = vi.hoisted(() => ({
    getTransportState: vi.fn(),
    addTrack: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: mocks.getTransportState,
}));

describe('generationHandlerHelpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('resolveOrCreateMidiTrack', () => {
        const deps = {
            addTrack: mocks.addTrack,
            getTrackStoreState: mocks.getTrackStoreState,
        };

        it('returns provided trackId if given', () => {
            const id = resolveOrCreateMidiTrack('explicit-id', 'Fallback', deps);
            expect(id).toBe('explicit-id');
            expect(mocks.getTrackStoreState).not.toHaveBeenCalled();
            expect(mocks.addTrack).not.toHaveBeenCalled();
        });

        it('returns selected track id if it is a midi track', () => {
            mocks.getTrackStoreState.mockReturnValue({
                selectedTrackId: 't2',
                tracks: [
                    { id: 't1', kind: 'audio' },
                    { id: 't2', kind: 'midi' },
                ]
            });
            const id = resolveOrCreateMidiTrack(undefined, 'Fallback', deps);
            expect(id).toBe('t2');
            expect(mocks.addTrack).not.toHaveBeenCalled();
        });

        it('returns first midi track if selected track is not midi', () => {
            mocks.getTrackStoreState.mockReturnValue({
                selectedTrackId: 't1',
                tracks: [
                    { id: 't1', kind: 'audio' },
                    { id: 't3', kind: 'midi' },
                ]
            });
            const id = resolveOrCreateMidiTrack(undefined, 'Fallback', deps);
            expect(id).toBe('t3');
            expect(mocks.addTrack).not.toHaveBeenCalled();
        });

        it('returns first midi track if no track is selected', () => {
            mocks.getTrackStoreState.mockReturnValue({
                selectedTrackId: null,
                tracks: [
                    { id: 't1', kind: 'audio' },
                    { id: 't3', kind: 'midi' },
                ]
            });
            const id = resolveOrCreateMidiTrack(undefined, 'Fallback', deps);
            expect(id).toBe('t3');
            expect(mocks.addTrack).not.toHaveBeenCalled();
        });

        it('creates a new track if no midi tracks exist', () => {
            mocks.getTrackStoreState.mockReturnValue({
                selectedTrackId: null,
                tracks: [
                    { id: 't1', kind: 'audio' },
                ]
            });
            mocks.addTrack.mockReturnValue({ id: 'new-t' });

            const id = resolveOrCreateMidiTrack(undefined, 'Fallback', deps);
            expect(id).toBe('new-t');
            expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'Fallback', kind: 'midi' });
        });

        it('returns null if track creation fails', () => {
            mocks.getTrackStoreState.mockReturnValue({
                selectedTrackId: null,
                tracks: []
            });
            mocks.addTrack.mockReturnValue(null);

            const id = resolveOrCreateMidiTrack(undefined, 'Fallback', deps);
            expect(id).toBeNull();
        });
    });

    describe('getPlayheadBeat', () => {
        it('returns playhead position from transport state', () => {
            mocks.getTransportState.mockReturnValue({ playheadPosition: 12 });
            expect(getPlayheadBeat()).toBe(12);
        });

        it('returns 0 if transport state is unavailable', () => {
            mocks.getTransportState.mockReturnValue(null);
            expect(getPlayheadBeat()).toBe(0);
        });
    });
});
