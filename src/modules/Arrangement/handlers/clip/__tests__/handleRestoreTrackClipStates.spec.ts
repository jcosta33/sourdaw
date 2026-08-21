import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    type ClipAutomationLaneSnapshot,
    type ClipSatelliteEntrySnapshot,
    type TrackClipStateSnapshot,
} from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { handleRestoreTrackClipStates } from '../handleRestoreTrackClipStates';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    updateTrack: vi.fn(),
    restoreMidiClipData: vi.fn(),
    writeClipSatelliteEntry: vi.fn(),
    applyClipAutomationLaneTransition: vi.fn(() => true),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    restoreMidiClipData: mocks.restoreMidiClipData,
}));

vi.mock('../../../stores/clipSatelliteState', () => ({
    writeClipSatelliteEntry: mocks.writeClipSatelliteEntry,
}));

vi.mock('../../../useCases/clip/applyClipAutomationLaneTransition', () => ({
    applyClipAutomationLaneTransition: mocks.applyClipAutomationLaneTransition,
}));

/** The track-level fields a collection rewrite overwrites, as `TrackDummy` has them. */
const TRACK_FIELDS = {
    kind: 'audio',
    devices: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    activeAlternativeId: 'alt-1',
    alternatives: [{ id: 'alt-1' }],
} as const satisfies TrackClipStateSnapshot['trackFields'];

function snapshotFor(
    trackId: string,
    clipIds: readonly string[],
    overrides?: Partial<TrackClipStateSnapshot>
): TrackClipStateSnapshot {
    return {
        trackId,
        clips: clipIds.map((id) => ClipDummy.create({ id, trackId })),
        trackFields: TRACK_FIELDS,
        midiNotesByClipId: {},
        midiCcByClipId: {},
        midiPitchBendByClipId: {},
        clipSatellites: [],
        clipAutomationLanes: [],
        ...overrides,
    };
}

describe('handleRestoreTrackClipStates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.applyClipAutomationLaneTransition.mockReturnValue(true);
    });

    describe('execute', () => {
        it('refuses and writes nothing when a named track is missing entirely', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1'])],
                    replacement: [snapshotFor('t1', [])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
            expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
        });

        it('refuses when a clip was added on the named track since capture', () => {
            const track = TrackDummy.create({
                id: 't1',
                clips: [ClipDummy.create({ id: 'c1' }), ClipDummy.create({ id: 'c2' })],
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1'])],
                    replacement: [snapshotFor('t1', [])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('refuses when a clip was removed on the named track since capture', () => {
            const track = TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'c1' })] });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1', 'c2'])],
                    replacement: [snapshotFor('t1', [])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('refuses when the clip order on the named track has changed since capture', () => {
            const track = TrackDummy.create({
                id: 't1',
                clips: [ClipDummy.create({ id: 'c2' }), ClipDummy.create({ id: 'c1' })],
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1', 'c2'])],
                    replacement: [snapshotFor('t1', [])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('writes nothing at all when only one of several named tracks diverges', () => {
            // Decisive test: a partial restore across the batch is exactly the lost
            // update this handler exists to prevent. t1 still matches; t2 does not.
            const trackOne = TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'c1' })] });
            const trackTwo = TrackDummy.create({
                id: 't2',
                clips: [ClipDummy.create({ id: 'c2' }), ClipDummy.create({ id: 'c3' })],
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [trackOne, trackTwo] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1']), snapshotFor('t2', ['c2'])],
                    replacement: [snapshotFor('t1', []), snapshotFor('t2', [])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
            expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
        });

        it('writes every replacement entry, clips and MIDI satellites, once the whole guard holds', () => {
            // The live track is what `flattenTrack` leaves behind: an audio track with
            // no devices, unfrozen, on a fresh alternative. The snapshot is what stood
            // there before, and every one of those fields has to come back — restoring
            // only `clips` hands the musician their MIDI clips on an audio track with no
            // instrument, no plugins and the frozen take gone.
            const track = TrackDummy.create({
                id: 't1',
                kind: 'audio',
                clips: [ClipDummy.create({ id: 'c1' })],
                devices: [],
                frozen: false,
                freezeState: { status: 'unfrozen' },
                activeAlternativeId: 'alt-2',
                alternatives: [{ id: 'alt-2', name: 'Alternative 2', clips: [] }],
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });
            const note = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
            const cc = { id: 'cc-1', controller: 1, value: 10, beat: 0, channel: 0 };
            const pitchBend = { id: 'pb-1', value: 0, beat: 0, channel: 0 };
            const restoredClip = ClipDummy.create({ id: 'restored-c1' });
            const preFlattenFields = {
                kind: 'midi' as const,
                devices: [{ id: 'device-1' }],
                frozen: true,
                frozenBufferId: 'buffer-1',
                freezeState: { status: 'frozen' as const },
                activeAlternativeId: 'alt-1',
                alternatives: [{ id: 'alt-1' }, { id: 'alt-9' }],
            };
            const satellite: ClipSatelliteEntrySnapshot = {
                clipId: 'restored-c1',
                gainEnvelope: {
                    clipId: 'restored-c1',
                    points: [{ id: 'gain-1', beatOffset: 0, gainDb: -6 }],
                    enabled: true,
                },
                warpState: null,
            };
            const lane: ClipAutomationLaneSnapshot = {
                id: 'lane-1',
                trackId: 't1',
                clipId: 'restored-c1',
                parameterId: 'volume',
                parameterName: 'Volume',
                points: [{ beat: 0, value: 0.5, curve: 'linear', tension: 0 }],
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
                minValue: 0,
                maxValue: 1,
            };

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1'])],
                    replacement: [
                        {
                            trackId: 't1',
                            clips: [restoredClip],
                            trackFields: preFlattenFields,
                            midiNotesByClipId: { 'restored-c1': [note] },
                            midiCcByClipId: { 'restored-c1': [cc] },
                            midiPitchBendByClipId: { 'restored-c1': [pitchBend] },
                            clipSatellites: [satellite],
                            clipAutomationLanes: [lane],
                        },
                    ],
                },
            });

            expect(result).toEqual({ status: 'written' });
            expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
            const [calledTrackId, updater] = mocks.updateTrack.mock.calls[0]!;
            expect(calledTrackId).toBe('t1');
            expect(updater(track)).toEqual({
                ...track,
                clips: [restoredClip],
                kind: 'midi',
                devices: [{ id: 'device-1' }],
                frozen: true,
                frozenBufferId: 'buffer-1',
                freezeState: { status: 'frozen' },
                activeAlternativeId: 'alt-1',
                alternatives: [{ id: 'alt-1' }, { id: 'alt-9' }],
            });
            expect(mocks.restoreMidiClipData).toHaveBeenCalledWith({
                clipId: 'restored-c1',
                notesSnapshot: [note],
                controlChangeSnapshot: [cc],
                pitchBendSnapshot: [pitchBend],
            });
            expect(mocks.writeClipSatelliteEntry).toHaveBeenCalledWith(satellite);
            expect(mocks.applyClipAutomationLaneTransition).toHaveBeenCalledWith(
                expect.arrayContaining(['c1', 'restored-c1']),
                [],
                [lane]
            );
        });

        it('refuses without touching any track when the automation lane transition refuses', () => {
            // Ordering proof: the lane transition runs before the first track write, so
            // a refusal there leaves the project exactly as it was rather than clips
            // restored with their automation gone.
            const track = TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'c1' })] });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });
            mocks.applyClipAutomationLaneTransition.mockReturnValue(false);

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1'])],
                    replacement: [snapshotFor('t1', ['restored-c1'])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
            expect(mocks.writeClipSatelliteEntry).not.toHaveBeenCalled();
        });

        it('refuses a replacement track the guard never covered', () => {
            const trackOne = TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'c1' })] });
            const trackTwo = TrackDummy.create({ id: 't2', clips: [ClipDummy.create({ id: 'c2' })] });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [trackOne, trackTwo] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1'])],
                    replacement: [snapshotFor('t1', []), snapshotFor('t2', [])],
                },
            });

            // Nothing proved t2's live state matches the snapshot's assumptions, so
            // writing it would be an unguarded overwrite of somebody else's edit.
            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('refuses an empty expected set rather than treating it as a match', () => {
            // `Array.every` is vacuously true on `[]`, so the entry-match half of the
            // guard says yes here. The counterpart requirement is what refuses: an empty
            // expected set describes no live state, so it can name no track to write.
            const track = TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'c1' })] });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: { expected: [], replacement: [snapshotFor('t1', ['restored-c1'])] },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('writes every named track when the whole guard holds across several tracks', () => {
            const trackOne = TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'c1' })] });
            const trackTwo = TrackDummy.create({ id: 't2', clips: [ClipDummy.create({ id: 'c2' })] });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [trackOne, trackTwo] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1']), snapshotFor('t2', ['c2'])],
                    replacement: [snapshotFor('t1', []), snapshotFor('t2', [])],
                },
            });

            expect(result).toEqual({ status: 'written' });
            expect(mocks.updateTrack).toHaveBeenCalledTimes(2);
            expect(mocks.updateTrack.mock.calls.map((call) => call[0])).toEqual(['t1', 't2']);
        });
    });

    it('describes with a null inverse action — invoked only by undo/redo machinery', () => {
        const desc = handleRestoreTrackClipStates.describe({
            type: 'restoreTrackClipStates',
            payload: { expected: [], replacement: [] },
        });

        expect(desc.label).toBe('Restore clip state');
        expect(desc.inverseAction).toBeNull();
    });

    describe('isNoop', () => {
        it('is true when every replacement entry already matches live state', () => {
            const track = TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'c1' })] });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const isNoop = handleRestoreTrackClipStates.isNoop?.({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [],
                    replacement: [snapshotFor('t1', ['c1'])],
                },
            });

            expect(isNoop).toBe(true);
        });

        it('is false when a replacement entry does not match live state', () => {
            const track = TrackDummy.create({ id: 't1', clips: [ClipDummy.create({ id: 'c1' })] });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const isNoop = handleRestoreTrackClipStates.isNoop?.({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [],
                    replacement: [snapshotFor('t1', ['c1', 'c2'])],
                },
            });

            expect(isNoop).toBe(false);
        });

        it('is true when there is nothing to restore at all', () => {
            // `execute` refuses an unguarded write, and a conflict leaves the entry on the
            // undo stack where it would refuse every later press. Reporting the empty
            // action as a no-op here is what keeps it off that path.
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

            const isNoop = handleRestoreTrackClipStates.isNoop?.({
                type: 'restoreTrackClipStates',
                payload: { expected: [], replacement: [] },
            });

            expect(isNoop).toBe(true);
        });
    });

    it('is not undoable — invoked only by undo/redo machinery', () => {
        expect(handleRestoreTrackClipStates.undoable).toBe(false);
    });
});
