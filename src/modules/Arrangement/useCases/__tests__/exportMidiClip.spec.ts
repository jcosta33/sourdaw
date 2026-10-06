import { describe, it, expect, vi, beforeEach } from 'vitest';

import { exportMidiClip } from '../exportMidiClip';

const mocks = vi.hoisted(() => ({
    getAllTracks: vi.fn(),
    downloadMidiFile: vi.fn(),
    getMidiStoreState: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
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

    describe('slipped and trimmed clips', () => {
        function note(id: string, startBeat: number, duration: number) {
            return { id, pitch: 60, startBeat, duration, velocity: 100 };
        }

        function controller(id: string, beat: number, value: number) {
            return { id, controller: 64, value, beat, channel: 0 };
        }

        function exportSlippedClip(hiddenControllers = [controller('hidden-down', 1, 100)]) {
            mocks.getAllTracks.mockReturnValue([
                {
                    id: 't1',
                    name: 'Keys',
                    clips: [
                        { id: 'clip-s', name: 'Slip', startBeat: 8, endBeat: 12, midiOffsetBeats: 2, type: 'midi' },
                    ],
                },
            ] as any);
            mocks.getMidiStoreState.mockReturnValue({
                notesByClipId: {
                    'clip-s': [
                        note('before', 1, 0.5),
                        note('straddles-start', 1.5, 1),
                        note('inside', 3, 1),
                        note('straddles-end', 5.5, 1),
                        note('after', 7, 1),
                    ],
                },
                ccByClipId: {
                    'clip-s': [...hiddenControllers, controller('inside-up', 3, 20)],
                },
                pitchBendByClipId: { 'clip-s': [{ id: 'bend', value: 0.5, beat: 3, channel: 0 }] },
            } as any);

            exportMidiClip('clip-s');

            return mocks.downloadMidiFile.mock.calls[0]?.[0];
        }

        it('exports the notes the clip plays for one pass, rebased by the content offset', () => {
            const exported = exportSlippedClip();

            expect(exported.clipStartBeat).toBe(8);
            expect(
                exported.notes.map((exportedNote: any) => [
                    exportedNote.id,
                    exportedNote.startBeat,
                    exportedNote.duration,
                ])
            ).toEqual([
                ['straddles-start', 0, 0.5],
                ['inside', 1, 1],
                ['straddles-end', 3.5, 0.5],
            ]);
        });

        it('starts the exported controllers from the value in force at the window start', () => {
            const exported = exportSlippedClip();

            expect(exported.ccs.map((row: any) => [row.id, row.beat, row.value])).toEqual([
                ['hidden-down', 0, 100],
                ['inside-up', 1, 20],
            ]);
        });

        it('starts from the latest hidden controller beat, not the first hidden row', () => {
            const exported = exportSlippedClip([controller('down', 0, 127), controller('up', 1, 0)]);

            expect(exported.ccs.map((row: any) => [row.id, row.beat, row.value])).toEqual([
                ['up', 0, 0],
                ['inside-up', 1, 20],
            ]);
        });

        it('starts from the latest hidden controller beat when rows are stored out of beat order', () => {
            const exported = exportSlippedClip([controller('up', 1, 0), controller('down', 0, 127)]);

            expect(exported.ccs.map((row: any) => [row.id, row.beat, row.value])).toEqual([
                ['up', 0, 0],
                ['inside-up', 1, 20],
            ]);
        });

        it('leaves out controller rows after the window end', () => {
            const exported = exportSlippedClip([controller('hidden-down', 1, 100), controller('after-end', 7, 55)]);

            expect(exported.ccs.map((row: any) => [row.id, row.beat, row.value])).toEqual([
                ['hidden-down', 0, 100],
                ['inside-up', 1, 20],
            ]);
        });

        it('starts from the later source row when hidden controller rows share a beat', () => {
            const exported = exportSlippedClip([controller('z-release', 1, 0), controller('a-press', 1, 127)]);

            expect(exported.ccs.map((row: any) => [row.id, row.beat, row.value])).toEqual([
                ['a-press', 0, 127],
                ['inside-up', 1, 20],
            ]);
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
