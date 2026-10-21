import { describe, it, expect, vi, beforeEach } from 'vitest';
import { insertPolyphonicMidiNotes } from '../insertPolyphonicMidiNotes';

const mocks = vi.hoisted(() => ({ getTransportState: vi.fn(), getAllTracks: vi.fn(), executeAppActionBatch: vi.fn() }));
vi.mock('#/modules/Arrangement/useCases', () => ({ getAllTracks: mocks.getAllTracks }));
vi.mock('#/modules/Command/useCases', () => ({ executeAppActionBatch: mocks.executeAppActionBatch }));
vi.mock('#/modules/Transport/useCases', () => ({ getTransportState: mocks.getTransportState }));
const sourceClip = { startBeat: 0, endBeat: 4, name: 'Vocal' };
const notes = [{ pitchMidi: 60, startTimeSeconds: 0.5, durationSeconds: 0.25, amplitude: 0.8 }];

describe('insertPolyphonicMidiNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAllTracks.mockReturnValue([]);
        mocks.getTransportState.mockReturnValue({ tempo: 120 });
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'committed', actions: [] });
    });
    it('commits pinned track, clip and mapped notes together', async () => {
        const result = await insertPolyphonicMidiNotes(notes, sourceClip, 'audio-track');
        expect(result).toMatchObject({ trackId: expect.any(String), clipId: expect.any(String) });
        expect(mocks.executeAppActionBatch).toHaveBeenCalledWith(
            [
                { type: 'addTrack', payload: { id: result!.trackId, name: 'Vocal (MIDI)', kind: 'midi' } },
                {
                    type: 'addClip',
                    payload: {
                        id: result!.clipId,
                        trackId: result!.trackId,
                        startBeat: 0,
                        endBeat: 4,
                        name: 'Vocal → MIDI (poly)',
                        type: 'midi',
                    },
                },
                {
                    type: 'addNotes',
                    payload: {
                        clipId: result!.clipId,
                        notes: [{ pitch: 60, startBeat: 1, duration: 0.5, velocity: 102 }],
                    },
                },
            ],
            expect.objectContaining({ requireCompensation: true, groupId: expect.any(String) })
        );
    });
    it('reuses an existing MIDI destination', async () => {
        mocks.getAllTracks.mockReturnValue([{ id: 'midi-track', kind: 'midi' }]);
        expect(await insertPolyphonicMidiNotes(notes, sourceClip, 'midi-track')).toMatchObject({
            trackId: 'midi-track',
        });
        expect(mocks.executeAppActionBatch.mock.calls[0][0].map((action: { type: string }) => action.type)).toEqual([
            'addClip',
            'addNotes',
        ]);
    });
    it('awaits committed dispatch before returning a created identity', async () => {
        let commit!: (result: { status: string; actions: [] }) => void;
        mocks.executeAppActionBatch.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    commit = resolve;
                })
        );
        let completed = false;
        const pending = insertPolyphonicMidiNotes(notes, sourceClip, 'audio').then((result) => {
            completed = true;
            return result;
        });
        expect(completed).toBe(false);
        commit({ status: 'committed', actions: [] });
        expect(await pending).not.toBeNull();
    });
    it('returns no output for rejected dispatch or empty transcription', async () => {
        mocks.executeAppActionBatch.mockResolvedValueOnce({ status: 'rejected', actions: [], reason: 'Denied' });
        expect(await insertPolyphonicMidiNotes(notes, sourceClip, 'audio')).toBeNull();
        mocks.executeAppActionBatch.mockClear();
        expect(await insertPolyphonicMidiNotes([], sourceClip, 'audio')).toBeNull();
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });
});
