import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportMidiClip } from '../exportMidiClip';

const mocks = vi.hoisted(() => ({
    getAllTracks: vi.fn(),
    downloadMidiFile: vi.fn(),
    getMidiStoreState: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    downloadMidiFile: mocks.downloadMidiFile,
    getMidiStoreState: mocks.getMidiStoreState,
}));

vi.mock('../getAllTracks', () => ({
    getAllTracks: mocks.getAllTracks,
}));

describe('exportMidiClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should not download when there are no tracks', () => {
        mocks.getAllTracks.mockReturnValue([]);
        mocks.getMidiStoreState.mockReturnValue({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        } as any);

        exportMidiClip('c1');

        expect(mocks.downloadMidiFile).not.toHaveBeenCalled();
    });

    it('should not download when the MIDI store is not initialized', () => {
        mocks.getAllTracks.mockReturnValue([{ id: 't1', name: 'T', clips: [] }] as any);
        mocks.getMidiStoreState.mockReturnValue(null);

        exportMidiClip('c1');

        expect(mocks.downloadMidiFile).not.toHaveBeenCalled();
    });

    it('should call downloadMidiFile with clip metadata and lane data for the clip id', () => {
        const note = { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
        mocks.getAllTracks.mockReturnValue([
            {
                id: 't1',
                name: 'Drums',
                clips: [
                    {
                        id: 'clip-a',
                        name: 'Fill',
                        startBeat: 8,
                        endBeat: 16,
                        type: 'midi',
                    },
                ],
            },
        ] as any);
        mocks.getMidiStoreState.mockReturnValue({
            notesByClipId: { 'clip-a': [note] },
            ccByClipId: { 'clip-a': [{ id: 'cc1', controller: 1, value: 64, beat: 0, channel: 0 }] },
            pitchBendByClipId: {},
        } as any);

        exportMidiClip('clip-a');

        expect(mocks.downloadMidiFile).toHaveBeenCalledWith({
            clipName: 'Fill',
            clipStartBeat: 8,
            notes: [note],
            ccs: [{ id: 'cc1', controller: 1, value: 64, beat: 0, channel: 0 }],
        });
    });

    it('should use the track name when the clip name is empty', () => {
        mocks.getAllTracks.mockReturnValue([
            {
                id: 't1',
                name: 'Bass',
                clips: [
                    {
                        id: 'clip-b',
                        name: '',
                        startBeat: 0,
                        endBeat: 4,
                        type: 'midi',
                    },
                ],
            },
        ] as any);
        mocks.getMidiStoreState.mockReturnValue({
            notesByClipId: { 'clip-b': [] },
            ccByClipId: { 'clip-b': [] },
            pitchBendByClipId: {},
        } as any);

        exportMidiClip('clip-b');

        expect(mocks.downloadMidiFile).toHaveBeenCalledWith(
            expect.objectContaining({
                clipName: 'Bass',
                clipStartBeat: 0,
            })
        );
    });

    it('should use default clip label and start beat when the clip id is not on any track', () => {
        mocks.getAllTracks.mockReturnValue([
            {
                id: 't1',
                name: 'T',
                clips: [
                    {
                        id: 'other',
                        name: 'X',
                        startBeat: 0,
                        endBeat: 1,
                        type: 'midi',
                    },
                ],
            },
        ] as any);
        mocks.getMidiStoreState.mockReturnValue({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        } as any);

        exportMidiClip('orphan');

        expect(mocks.downloadMidiFile).toHaveBeenCalledWith({
            clipName: 'export',
            clipStartBeat: 0,
            notes: [],
            ccs: [],
        });
    });
});
