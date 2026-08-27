import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    type ClipAutomationLaneSnapshot,
    type ClipSatelliteEntrySnapshot,
    type TrackClipStateSnapshot,
} from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip, type Device, type Track } from '../../../stores/trackStore';
import { handleRestoreTrackClipStates } from '../handleRestoreTrackClipStates';

/** The three per-clip MIDI maps the guard reads off the live store. */
type MidiLanes = Readonly<Record<string, readonly { readonly id: string }[]>>;
type FakeMidiState = {
    notesByClipId: MidiLanes;
    ccByClipId: MidiLanes;
    pitchBendByClipId: MidiLanes;
};

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    updateTrack: vi.fn(),
    restoreMidiClipData: vi.fn(),
    writeClipSatelliteEntry: vi.fn(),
    readClipSatelliteEntry: vi.fn((clipId: string): ClipSatelliteEntrySnapshot => ({
        clipId,
        gainEnvelope: null,
        warpState: null,
    })),
    applyClipAutomationLaneTransition: vi.fn(() => true),
    midiStore: { value: null as FakeMidiState | null },
}));

vi.mock('#/modules/MIDI/stores', () => ({ midiStore: mocks.midiStore }));

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
    readClipSatelliteEntry: mocks.readClipSatelliteEntry,
}));

vi.mock('../../../useCases/clip/applyClipAutomationLaneTransition', () => ({
    applyClipAutomationLaneTransition: mocks.applyClipAutomationLaneTransition,
}));

/**
 * The track-level fields a collection rewrite overwrites, in the live track's own shape.
 *
 * One helper for the live track and the snapshot, for the reason `clipsFor` gives below
 * and against the same failure. `TrackDummy` seeds its take lane with a `name` while
 * this fixture spelled out an unnamed one, so every case in this file paired a named
 * live lane against a nameless snapshot lane — twenty passing tests over a field no
 * comparison read. A fresh object per call, so a live value and a snapshot value are
 * never the same reference and a comparison has something to do.
 */
function trackFields() {
    return {
        kind: 'audio',
        devices: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
    } satisfies Partial<Track>;
}

/**
 * The two-lane shape the hidden-lane cases use, following this file's own `alt-1`/
 * `alt-9` idiom: `alt-1` is the active lane — `trackFields()` names it in
 * `activeAlternativeId` — and stays empty on both sides, so the only divergence
 * anywhere is inside non-active `alt-9`, the lane under test. A clip edited while a
 * lane is active and then switched away is the one reachable state that leaves
 * `track.clips` matching the snapshot, which is what makes `alt-9` the lane these
 * cases must diverge rather than the active one. Fresh objects per call, for the
 * reason `trackFields` gives: a live lane and a snapshot lane are never the same
 * reference, so the comparison has something to do.
 */
function lanesWith(laneClips: Clip[]) {
    return [
        { id: 'alt-1', name: 'Alternative 1', clips: [] as Clip[] },
        { id: 'alt-9', name: 'Alternative 9', clips: laneClips },
    ];
}

/**
 * The clips both sides of the guard are built from.
 *
 * One helper for the live track and the snapshot deliberately. `ClipDummy.create`
 * defaults `trackId` to `'track-1'`, so the live tracks here used to be seeded with
 * `ClipDummy.create({ id })` while the snapshot passed the real track id — leaving the
 * two sides disagreeing on a field the guard did not read. Every test in this file
 * passed anyway, because the guard compared ids alone. Building both sides from one
 * helper is what makes a content comparison mean something here: it puts the fixture
 * in the state an undivergent undo is actually in, so a test that expects a match is
 * asserting agreement rather than a comparison that never happened.
 */
function clipsFor(trackId: string, clipIds: readonly string[]): Clip[] {
    return clipIds.map((id) => ClipDummy.create({ id, trackId }));
}

function snapshotFor(
    trackId: string,
    clipIds: readonly string[],
    overrides?: Partial<TrackClipStateSnapshot>
): TrackClipStateSnapshot {
    return {
        trackId,
        clips: clipsFor(trackId, clipIds),
        trackFields: trackFields(),
        midiNotesByClipId: {},
        midiCcByClipId: {},
        midiPitchBendByClipId: {},
        clipSatellites: [],
        clipAutomationLanes: [],
        ...overrides,
    };
}

/** A live track carrying exactly the clips and track fields `snapshotFor` would
 *  snapshot for it. */
function liveTrack(trackId: string, clipIds: readonly string[], overrides?: Partial<Track>): Track {
    return TrackDummy.create({
        id: trackId,
        clips: clipsFor(trackId, clipIds),
        ...trackFields(),
        ...overrides,
    });
}

describe('handleRestoreTrackClipStates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.applyClipAutomationLaneTransition.mockReturnValue(true);
        // `clearAllMocks` clears recorded calls, not implementations, so a
        // `mockReturnValue` from one test would otherwise stand for the rest of the
        // file. Both of these are read by the guard on every case.
        mocks.readClipSatelliteEntry.mockImplementation((clipId: string) => ({
            clipId,
            gainEnvelope: null,
            warpState: null,
        }));
        mocks.midiStore.value = null;
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
            const track = liveTrack('t1', ['c1', 'c2']);
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
            const track = liveTrack('t1', ['c1']);
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
            const track = liveTrack('t1', ['c2', 'c1']);
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
            const trackOne = liveTrack('t1', ['c1']);
            const trackTwo = liveTrack('t2', ['c2', 'c3']);
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

        it('refuses when a clip was edited in place, leaving the id sequence identical', () => {
            // The reachable single-user case. `updateClipInStore` replaces a clip at its
            // existing index, so every in-place edit — position, length, gain, fades,
            // lock, colour — leaves the id sequence byte-identical. A guard that reads
            // no further than the id reports a match and drops the pre-operation clip on
            // top of the edit.
            const [edited] = clipsFor('t1', ['c1']);
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [TrackDummy.create({ id: 't1', clips: [{ ...edited!, gain: 0.25, endBeat: 9 }] })],
            });

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

        it('refuses when a clip fileId diverges between live and expected clip state', () => {
            const [clip] = clipsFor('t1', ['c1']);
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    TrackDummy.create({
                        id: 't1',
                        clips: [{ ...clip!, fileId: 'file-live' }],
                    }),
                ],
            });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [
                        snapshotFor('t1', ['c1'], {
                            clips: [{ ...clip!, fileId: 'file-expected' }],
                        }),
                    ],
                    replacement: [snapshotFor('t1', [])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('refuses when a sibling clip was retuned in place through the Knead editor', () => {
            // Knead writes `kneadState` through `updateClipInStore` without going through
            // `executeAppAction`, so a retune files no undo entry of its own to protect
            // it — the same situation `deviceState` is in. The retuned clip is not the
            // clip being restored; it only shares a track with it.
            //
            // The snapshot carries a payload of its own here, which is what makes the
            // divergence an edit rather than an absence: a clip that had no `kneadState`
            // at capture is the seeded-analysis case two tests below, and must not
            // conflict.
            const captured = {
                blobs: [],
                retuneSpeedMs: 25,
                humanizePercent: 40,
                formantPreserve: true,
            };
            const [kept, retuned] = clipsFor('t1', ['c1', 'c2']);
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    TrackDummy.create({
                        id: 't1',
                        ...trackFields(),
                        clips: [
                            kept!,
                            {
                                ...retuned!,
                                kneadState: { ...captured, retuneSpeedMs: 5, humanizePercent: 0 },
                            },
                        ],
                    }),
                ],
            });
            const capturedSnapshot = snapshotFor('t1', ['c1', 'c2']);

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [
                        {
                            ...capturedSnapshot,
                            clips: capturedSnapshot.clips.map((clip) =>
                                clip.id === 'c2' ? { ...clip, kneadState: captured } : clip
                            ),
                        },
                    ],
                    replacement: [snapshotFor('t1', ['c1'])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('still restores when a sibling clip acquired a Knead state the snapshot never carried', () => {
            // Selecting a clip while the Knead editor is the open audio-edit mode fires
            // the pitch analysis on it, and `updateClipKneadState` seeds a default
            // payload for a clip that had no state at all — the same seeded shape here.
            // That is a view action, not an edit, and the snapshot has no `kneadState` to
            // restore over it, so refusing would kill the undo stack for nothing.
            const [kept, analysed] = clipsFor('t1', ['c1', 'c2']);
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    TrackDummy.create({
                        id: 't1',
                        ...trackFields(),
                        clips: [
                            kept!,
                            {
                                ...analysed!,
                                kneadState: {
                                    blobs: [],
                                    retuneSpeedMs: 25,
                                    humanizePercent: 40,
                                    formantPreserve: true,
                                },
                            },
                        ],
                    }),
                ],
            });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1', 'c2'])],
                    replacement: [snapshotFor('t1', ['c1', 'c2'])],
                },
            });

            expect(result).toEqual({ status: 'written' });
            expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
        });

        it('leaves a live Knead state in place rather than writing the snapshot absence over it', () => {
            // The write side of the same exclusion. The guard declined to compare this
            // field, so the write must not replace it either — a wholesale clip array
            // replacement would silently drop the analysis the guard was never asked
            // about, which is the loss the comparator exists to prevent.
            const [analysed] = clipsFor('t1', ['c1']);
            const kneadState = {
                blobs: [],
                retuneSpeedMs: 25,
                humanizePercent: 40,
                formantPreserve: true,
            };
            const track = TrackDummy.create({
                id: 't1',
                ...trackFields(),
                clips: [{ ...analysed!, kneadState }],
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1'])],
                    replacement: [snapshotFor('t1', ['c1'])],
                },
            });

            expect(result).toEqual({ status: 'written' });
            const [, updater] = mocks.updateTrack.mock.calls[0]!;
            expect(updater(track).clips[0]?.kneadState).toEqual(kneadState);
        });

        it('still restores when a document projection narrowed a Knead state the snapshot captured wide', () => {
            // `updateClipKneadState` writes Knead's own wider state onto the clip, and
            // every document-origin projection — collaboration sync, merge-on-open,
            // snapshot install — rebuilds it down to the fields `ClipKneadState`
            // declares, none of which clears the undo stack. The two sides then hold the
            // same authored retune in two shapes, and refusing on that difference kills
            // undo for the rest of the session over a narrowing the app performed on
            // itself.
            const wideAtCapture = {
                clipId: 'c2',
                blobs: [
                    {
                        id: 'blob-1',
                        startTime: 0,
                        endTime: 1,
                        pitchCenterCents: 100,
                        originalPitchCenterCents: 90,
                        pitchCurveCents: [100, 101],
                        voicedConfidence: 0.9,
                        driftPercent: 0,
                        vibratoDepthPercent: 0,
                        vibratoRateHz: 0,
                        formantShiftCents: 0,
                        gainDb: 0,
                        muted: false,
                    },
                ],
                retuneSpeedMs: 25,
                toleranceCents: 25,
                toleranceTimeMs: 30,
                humanizePercent: 40,
                formantPreserve: true,
            };
            const narrowedByProjection = {
                blobs: [
                    {
                        id: 'blob-1',
                        startTime: 0,
                        endTime: 1,
                        pitchCenterCents: 100,
                        originalPitchCenterCents: 90,
                        pitchCurveCents: [100, 101],
                        voicedConfidence: 0.9,
                    },
                ],
                retuneSpeedMs: 25,
                humanizePercent: 40,
                formantPreserve: true,
            };
            const [kept, retuned] = clipsFor('t1', ['c1', 'c2']);
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    TrackDummy.create({
                        id: 't1',
                        ...trackFields(),
                        clips: [kept!, { ...retuned!, kneadState: narrowedByProjection }],
                    }),
                ],
            });
            const capturedSnapshot = snapshotFor('t1', ['c1', 'c2']);

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [
                        {
                            ...capturedSnapshot,
                            clips: capturedSnapshot.clips.map((clip) =>
                                clip.id === 'c2' ? { ...clip, kneadState: wideAtCapture } : clip
                            ),
                        },
                    ],
                    replacement: [snapshotFor('t1', ['c1', 'c2'])],
                },
            });

            expect(result).toEqual({ status: 'written' });
            expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
        });

        it('still refuses when a retune changed a declared Knead field after a wide capture', () => {
            // The counterpart of the case above, and what stops the projection tolerance
            // from becoming a blanket exemption: the shapes differ in exactly the same
            // way, but `retuneSpeedMs` is a field the musician authored and the restore
            // would throw it away.
            const wideAtCapture = {
                clipId: 'c2',
                blobs: [],
                retuneSpeedMs: 25,
                toleranceCents: 25,
                toleranceTimeMs: 30,
                humanizePercent: 40,
                formantPreserve: true,
            };
            const retunedSinceCapture = {
                blobs: [],
                retuneSpeedMs: 5,
                humanizePercent: 40,
                formantPreserve: true,
            };
            const [kept, retuned] = clipsFor('t1', ['c1', 'c2']);
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    TrackDummy.create({
                        id: 't1',
                        ...trackFields(),
                        clips: [kept!, { ...retuned!, kneadState: retunedSinceCapture }],
                    }),
                ],
            });
            const capturedSnapshot = snapshotFor('t1', ['c1', 'c2']);

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [
                        {
                            ...capturedSnapshot,
                            clips: capturedSnapshot.clips.map((clip) =>
                                clip.id === 'c2' ? { ...clip, kneadState: wideAtCapture } : clip
                            ),
                        },
                    ],
                    replacement: [snapshotFor('t1', ['c1'])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('refuses when a take lane was renamed since capture', () => {
            // `renameTrackAlternative` writes only the lane's `name`, and the restore
            // puts the whole captured lane back. Left uncompared, undoing a cut reverts
            // a collaborator's rename and reports the restore as written.
            const track = liveTrack('t1', ['c1'], {
                alternatives: [{ id: 'alt-1', name: 'Comp B', clips: [] }],
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

        it('refuses when a clip inside a hidden take lane was edited since capture', () => {
            // The hidden-lane counterpart of the in-place-edit test above, and the case
            // that makes an id sequence insufficient here. The take was edited while
            // active and switched away, so at restore time `track.clips` matches the
            // snapshot and the edit lives only inside non-active `alt-9`. Variation-lane
            // rendering draws that lane too, but read-only, so this comparison is the
            // only thing standing between the restore and the edit: an id-sequence-only
            // guard reports `written` while dropping the edit — a loss that surfaces
            // only when the musician switches back to the take, by which point the undo
            // history has moved on.
            const [captured] = clipsFor('t1', ['c1']);
            const track = liveTrack('t1', ['c1'], {
                alternatives: lanesWith([{ ...captured!, gain: 0.25, endBeat: 9 }]),
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [
                        snapshotFor('t1', ['c1'], {
                            trackFields: { ...trackFields(), alternatives: lanesWith([captured!]) },
                        }),
                    ],
                    replacement: [snapshotFor('t1', [])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('still restores when the only divergence in a hidden take lane is an inline editor left open', () => {
            // The consistency guarantee: the lane's clips ride the same `clipsMatch` as
            // the live sequence, so the comparator's exclusions reach them too. An
            // editor open on a hidden lane's clip is not project content, and refusing
            // here would trade a closed editor — one click to reopen — for a dead undo
            // stack.
            const [captured] = clipsFor('t1', ['c1']);
            const track = liveTrack('t1', ['c1'], {
                alternatives: lanesWith([{ ...captured!, isInlineEditing: true }]),
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [
                        snapshotFor('t1', ['c1'], {
                            trackFields: { ...trackFields(), alternatives: lanesWith([captured!]) },
                        }),
                    ],
                    replacement: [
                        snapshotFor('t1', ['c1'], {
                            trackFields: { ...trackFields(), alternatives: lanesWith([captured!]) },
                        }),
                    ],
                },
            });

            expect(result).toEqual({ status: 'written' });
            expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
        });

        it('still restores when a clip in a hidden take lane acquired a Knead state the snapshot never carried', () => {
            // The seeded-analysis case one level down. The snapshot has no `kneadState`
            // for the lane's clip, so the guard declines to compare it — and the write
            // must decline with it, because the lane's clips go through the same
            // `restoredClips` reconciliation as the live sequence. The live analysis
            // survives the restore rather than being written over by the absence.
            const [captured] = clipsFor('t1', ['c1']);
            const kneadState = {
                blobs: [],
                retuneSpeedMs: 25,
                humanizePercent: 40,
                formantPreserve: true,
            };
            const track = liveTrack('t1', ['c1'], {
                alternatives: lanesWith([{ ...captured!, kneadState }]),
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [
                        snapshotFor('t1', ['c1'], {
                            trackFields: { ...trackFields(), alternatives: lanesWith([captured!]) },
                        }),
                    ],
                    replacement: [
                        snapshotFor('t1', ['c1'], {
                            trackFields: { ...trackFields(), alternatives: lanesWith([captured!]) },
                        }),
                    ],
                },
            });

            expect(result).toEqual({ status: 'written' });
            const [, updater] = mocks.updateTrack.mock.calls[0]!;
            // `alt-9`, the non-active lane under test, is the second lane written.
            expect(updater(track).alternatives[1]?.clips[0]?.kneadState).toEqual(kneadState);
        });

        it('refuses when a device was pointed at a different plugin instance since capture', () => {
            const device = {
                id: 'device-1',
                name: 'Reverb',
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalPluginId: 'com.vendor.reverb',
                externalInstanceId: 'com.vendor.reverb-instance-1',
            };
            const track = liveTrack('t1', ['c1'], {
                devices: [{ ...device, externalInstanceId: 'com.vendor.reverb-instance-2' }],
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1'], { trackFields: { ...trackFields(), devices: [device] } })],
                    replacement: [snapshotFor('t1', [])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('leaves a live plugin state chunk in place while restoring the rest of the device', () => {
            // `externalStateChunk` is the one device field the guard does not compare, so
            // the write must not replace it — and nothing downstream repairs a stale one.
            // `captureExternalPluginStates` skips on its own cached host read before it
            // ever looks at the store, so a chunk rolled back here is never re-committed:
            // the project saves the pre-edit chunk and the musician's plugin edit is gone
            // at the next reopen, with nothing on the undo stack that would bring it back.
            const device = {
                id: 'device-1',
                name: 'Reverb',
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalPluginId: 'com.vendor.reverb',
                externalInstanceId: 'com.vendor.reverb-instance-1',
            };
            const track = liveTrack('t1', ['c1'], {
                devices: [{ ...device, bypassed: true, externalStateChunk: 'chunk-from-the-plugin-editor' }],
            });
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [
                        snapshotFor('t1', ['c1'], {
                            trackFields: {
                                ...trackFields(),
                                devices: [{ ...device, bypassed: true, externalStateChunk: 'chunk-at-capture' }],
                            },
                        }),
                    ],
                    replacement: [
                        snapshotFor('t1', ['c1'], {
                            trackFields: {
                                ...trackFields(),
                                devices: [{ ...device, externalStateChunk: 'chunk-at-capture' }],
                            },
                        }),
                    ],
                },
            });

            expect(result).toEqual({ status: 'written' });
            const [, updater] = mocks.updateTrack.mock.calls[0]!;
            const restoredDevice = updater(track).devices[0];
            expect(restoredDevice.externalStateChunk).toBe('chunk-from-the-plugin-editor');
            // The rest of the device still comes back, so preserving the chunk is not a
            // licence to skip the device write.
            expect(restoredDevice.bypassed).toBe(false);
        });

        it('refuses when MIDI notes on a clip the snapshot carries were edited since capture', () => {
            // `captureTrackClipStates` snapshots MIDI for every clip id on the track, and
            // the restore writes all of them back. A note edited on a clip that merely
            // shares a track with the cut clip is inside that blast radius.
            // `MidiNotesSnapshot` declares only `id`, while the capture puts whole cloned
            // notes here — so the pitch difference these two carry is invisible to the
            // declared type and has to be compared structurally.
            const capturedNote = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
            const editedNote = { ...capturedNote, pitch: 67 };
            mocks.getTrackStoreState.mockReturnValue({ tracks: [liveTrack('t1', ['c1'])] });
            mocks.midiStore.value = {
                notesByClipId: { c1: [editedNote] },
                ccByClipId: {},
                pitchBendByClipId: {},
            };

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1'], { midiNotesByClipId: { c1: [capturedNote] } })],
                    replacement: [snapshotFor('t1', ['c1'])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
            expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
        });

        it('refuses when a gain envelope the snapshot would overwrite was redrawn since capture', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [liveTrack('t1', ['c1'])] });
            mocks.readClipSatelliteEntry.mockReturnValue({
                clipId: 'c1',
                gainEnvelope: { clipId: 'c1', points: [{ id: 'gain-1', beatOffset: 0, gainDb: 0 }], enabled: true },
                warpState: null,
            });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [
                        snapshotFor('t1', ['c1'], {
                            clipSatellites: [
                                {
                                    clipId: 'c1',
                                    gainEnvelope: {
                                        clipId: 'c1',
                                        points: [{ id: 'gain-1', beatOffset: 0, gainDb: -12 }],
                                        enabled: true,
                                    },
                                    warpState: null,
                                },
                            ],
                        }),
                    ],
                    replacement: [snapshotFor('t1', ['c1'])],
                },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
            expect(mocks.writeClipSatelliteEntry).not.toHaveBeenCalled();
        });

        it('still restores when the only difference is an inline editor left open', () => {
            // The exclusion, exercised rather than asserted in a comment. Refusing here
            // would trade a closed editor — one click to reopen — for a dead undo stack
            // the user is never told about.
            const [clip] = clipsFor('t1', ['c1']);
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [TrackDummy.create({ id: 't1', clips: [{ ...clip!, isInlineEditing: true }] })],
            });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: {
                    expected: [snapshotFor('t1', ['c1'])],
                    replacement: [snapshotFor('t1', [])],
                },
            });

            expect(result).toEqual({ status: 'written' });
            expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
        });

        it('writes every replacement entry, clips and MIDI satellites, once the whole guard holds', () => {
            // The live track is what `flattenTrack` leaves behind: an audio track with
            // no devices, unfrozen, on a fresh alternative. The snapshot is what stood
            // there before, and every one of those fields has to come back — restoring
            // only `clips` hands the musician their MIDI clips on an audio track with no
            // instrument, no plugins and the frozen take gone.
            // What the live track holds now — `flattenTrack`'s own output. `expected` is
            // always the post-write state, so the guard compares these against live, and
            // the live track below is built from this same value rather than restating it.
            const postFlattenFields = {
                kind: 'audio' as const,
                devices: [],
                frozen: false,
                freezeState: { status: 'unfrozen' as const },
                activeAlternativeId: 'alt-2',
                alternatives: [{ id: 'alt-2', name: 'Alternative 2', clips: [] }],
            } satisfies TrackClipStateSnapshot['trackFields'];
            const track = liveTrack('t1', ['c1'], structuredClone(postFlattenFields));
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });
            const note = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
            const cc = { id: 'cc-1', controller: 1, value: 10, beat: 0, channel: 0 };
            const pitchBend = { id: 'pb-1', value: 0, beat: 0, channel: 0 };
            const restoredClip = ClipDummy.create({ id: 'restored-c1', trackId: 't1' });
            const preFlattenFields = {
                kind: 'midi' as const,
                devices: [
                    { id: 'device-1', name: 'Synth', type: 'builtin-synth', bypassed: false, parameterValues: {} },
                ],
                frozen: true,
                frozenBufferId: 'buffer-1',
                freezeState: { status: 'frozen' as const },
                activeAlternativeId: 'alt-1',
                alternatives: [
                    { id: 'alt-1', name: 'Alternative 1', clips: [] },
                    { id: 'alt-9', name: 'Alternative 9', clips: [] },
                ],
            } satisfies TrackClipStateSnapshot['trackFields'];
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
                    expected: [snapshotFor('t1', ['c1'], { trackFields: postFlattenFields })],
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
                ...preFlattenFields,
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
            const track = liveTrack('t1', ['c1']);
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
            const trackOne = liveTrack('t1', ['c1']);
            const trackTwo = liveTrack('t2', ['c2']);
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
            const track = liveTrack('t1', ['c1']);
            mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

            const result = handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: { expected: [], replacement: [snapshotFor('t1', ['restored-c1'])] },
            });

            expect(result).toEqual({ status: 'conflict' });
            expect(mocks.updateTrack).not.toHaveBeenCalled();
        });

        it('writes every named track when the whole guard holds across several tracks', () => {
            const trackOne = liveTrack('t1', ['c1']);
            const trackTwo = liveTrack('t2', ['c2']);
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

        /**
         * Falsifiability suite for the comparator tables: every comparator body that no
         * case above diverges gets one here, edited in exactly the field it compares, so
         * hollowing that body to an unconditional `true` fails exactly its own case.
         *
         * A comparator that is deliberately absent from this suite is absent for a stated
         * reason, not an oversight:
         *
         * - `id` (clip) — the clip-order case above diverges it and nothing else.
         * - `fileId`, `kneadState` (clip) — their named cases above diverge exactly them.
         * - `isInlineEditing` (clip), `clipAutomationLanes` (snapshot entry) — deliberate
         *   `notCompared` exclusions, each pinned by its own still-restores case.
         * - `trackId` (snapshot entry) — has no falsifying case and cannot have one:
         *   `entryMatchesLiveState` finds the track by `entry.trackId`, so by the time the
         *   guard runs, `track.id === entry.trackId` is true by construction. The body is
         *   a defensive restatement of the lookup, not an observable check.
         * - `devices`, `alternatives` (track fields), `name`/`clips` (alternative),
         *   `clips`/`trackFields`/`midiNotesByClipId`/`clipSatellites` (snapshot entry) —
         *   each has a case above whose divergence is that key and only it.
         */
        describe('comparator falsifiability — each arm refuses the edit it compares', () => {
            /**
             * One row per clip comparator no case above diverges. The live clip is the
             * captured clip plus exactly one edited field, so the refusal can come only
             * from that field's comparator — which is what makes hollowing that one body
             * fail exactly this row and nothing else.
             */
            const clipFieldDivergences = [
                ['trackId', { trackId: 't-other' }],
                ['name', { name: 'Renamed since capture' }],
                ['startBeat', { startBeat: 1 }],
                ['endBeat', { endBeat: 8 }],
                ['type', { type: 'midi' }],
                ['audioBufferId', { audioBufferId: 'buffer-live' }],
                ['assetHash', { assetHash: 'hash-live' }],
                ['audioOffsetBeats', { audioOffsetBeats: 1.5 }],
                ['midiOffsetBeats', { midiOffsetBeats: 1.5 }],
                ['fadeInBeats', { fadeInBeats: 0.25 }],
                ['fadeOutBeats', { fadeOutBeats: 0.25 }],
                ['gain', { gain: 0.25 }],
                ['color', { color: '#0000ff' }],
                ['locked', { locked: true }],
                ['muted', { muted: true }],
                ['stretchMode', { stretchMode: 'repitch' }],
                ['stretchRatio', { stretchRatio: 1.25 }],
                ['loopEnabled', { loopEnabled: true }],
                ['loopLength', { loopLength: 2 }],
                ['followAction', { followAction: 'stop' }],
                ['generating', { generating: true }],
                ['isGhost', { isGhost: true }],
                ['parentClipId', { parentClipId: 'parent-clip' }],
                ['isLinkedInstance', { isLinkedInstance: true }],
                ['sourceKeyRoot', { sourceKeyRoot: 9 }],
                ['sourceScaleName', { sourceScaleName: 'Phrygian' }],
                ['overrides', { overrides: { gain: true } }],
            ] as const satisfies readonly (readonly [string, Partial<Clip>])[];

            it.each(clipFieldDivergences)('refuses when a clip %s was edited since capture', (field, liveEdit) => {
                const [captured] = clipsFor('t1', ['c1']);
                mocks.getTrackStoreState.mockReturnValue({
                    tracks: [liveTrack('t1', [], { clips: [{ ...captured!, ...liveEdit }] })],
                });

                const result = handleRestoreTrackClipStates.execute({
                    type: 'restoreTrackClipStates',
                    payload: {
                        expected: [snapshotFor('t1', ['c1'])],
                        replacement: [snapshotFor('t1', [])],
                    },
                });

                expect(result, `the ${field} comparator must refuse this restore`).toEqual({ status: 'conflict' });
                expect(mocks.updateTrack).not.toHaveBeenCalled();
            });

            /**
             * The device as captured, carrying every field `deviceMatches` reads so each
             * row below can diverge exactly one of them.
             */
            const deviceAtCapture: Device = {
                id: 'device-1',
                name: 'Reverb',
                type: 'external-plugin',
                bypassed: false,
                parameterValues: { mix: 0 },
                externalPluginId: 'com.vendor.reverb',
                externalInstanceId: 'com.vendor.reverb-instance-1',
                deviceState: { version: 1, data: { preset: 'plate' } },
            };

            /**
             * One row per device comparison no case above diverges. `deviceState` gets
             * three rows because `deviceStateMatches` is three decisions — presence,
             * version and payload — and a weakening may keep any two of them.
             */
            const deviceFieldDivergences = [
                ['id', { id: 'device-replaced' }],
                ['name', { name: 'Tape Reverb' }],
                ['type', { type: 'builtin-synth' }],
                ['bypassed', { bypassed: true }],
                ['externalPluginId', { externalPluginId: 'com.vendor.other' }],
                ['parameterValues', { parameterValues: { mix: 0.75 } }],
                ['deviceState payload', { deviceState: { version: 1, data: { preset: 'spring' } } }],
                ['deviceState version', { deviceState: { version: 2, data: { preset: 'plate' } } }],
                ['deviceState presence', { deviceState: undefined }],
            ] as const satisfies readonly (readonly [string, Partial<Device>])[];

            it.each(deviceFieldDivergences)(
                'refuses when a device %s diverges between live and capture',
                (field, liveEdit) => {
                    const track = liveTrack('t1', ['c1'], {
                        devices: [{ ...deviceAtCapture, ...liveEdit }],
                    });
                    mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

                    const result = handleRestoreTrackClipStates.execute({
                        type: 'restoreTrackClipStates',
                        payload: {
                            expected: [
                                snapshotFor('t1', ['c1'], {
                                    trackFields: { ...trackFields(), devices: [deviceAtCapture] },
                                }),
                            ],
                            replacement: [snapshotFor('t1', [])],
                        },
                    });

                    expect(result, `the device ${field} comparison must refuse this restore`).toEqual({
                        status: 'conflict',
                    });
                    expect(mocks.updateTrack).not.toHaveBeenCalled();
                }
            );

            /** Two devices identical except their id, so positional pairing is the only
             *  thing a reorder of them can trip. */
            const chainDeviceA: Device = {
                id: 'device-a',
                name: 'Chorus',
                type: 'builtin-effect',
                bypassed: false,
                parameterValues: {},
            };

            it('refuses when a device was added to the chain since capture', () => {
                // The length half of `devicesMatch`. A guard that only checked each
                // captured device still exists somewhere would authorise dropping the
                // newly added one from the chain.
                const track = liveTrack('t1', ['c1'], {
                    devices: [chainDeviceA, { ...chainDeviceA, id: 'device-b' }],
                });
                mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

                const result = handleRestoreTrackClipStates.execute({
                    type: 'restoreTrackClipStates',
                    payload: {
                        expected: [
                            snapshotFor('t1', ['c1'], {
                                trackFields: { ...trackFields(), devices: [chainDeviceA] },
                            }),
                        ],
                        replacement: [snapshotFor('t1', [])],
                    },
                });

                expect(result).toEqual({ status: 'conflict' });
                expect(mocks.updateTrack).not.toHaveBeenCalled();
            });

            it('refuses when a device was removed from the chain since capture', () => {
                // The other half of the length check. A guard comparing only the live
                // prefix against the snapshot would reinstate a device the musician
                // deleted and report the restore as written.
                const track = liveTrack('t1', ['c1'], { devices: [chainDeviceA] });
                mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

                const result = handleRestoreTrackClipStates.execute({
                    type: 'restoreTrackClipStates',
                    payload: {
                        expected: [
                            snapshotFor('t1', ['c1'], {
                                trackFields: {
                                    ...trackFields(),
                                    devices: [chainDeviceA, { ...chainDeviceA, id: 'device-b' }],
                                },
                            }),
                        ],
                        replacement: [snapshotFor('t1', [])],
                    },
                });

                expect(result).toEqual({ status: 'conflict' });
                expect(mocks.updateTrack).not.toHaveBeenCalled();
            });

            it('refuses when the device chain was reordered since capture', () => {
                // The positional half of `devicesMatch`. The two devices differ in
                // nothing but their id, so a reorder is detectable only by pairing
                // position against position: pairing by identity instead reports a
                // match and writes the stale signal path.
                const track = liveTrack('t1', ['c1'], {
                    devices: [{ ...chainDeviceA, id: 'device-b' }, chainDeviceA],
                });
                mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

                const result = handleRestoreTrackClipStates.execute({
                    type: 'restoreTrackClipStates',
                    payload: {
                        expected: [
                            snapshotFor('t1', ['c1'], {
                                trackFields: {
                                    ...trackFields(),
                                    devices: [chainDeviceA, { ...chainDeviceA, id: 'device-b' }],
                                },
                            }),
                        ],
                        replacement: [snapshotFor('t1', [])],
                    },
                });

                expect(result).toEqual({ status: 'conflict' });
                expect(mocks.updateTrack).not.toHaveBeenCalled();
            });

            it('refuses when the track kind changed since capture', () => {
                // The restore writes `kind` back with the rest of the track fields, so
                // a track flattened to audio and switched back to midi since capture
                // must conflict rather than be silently re-flattened.
                const track = liveTrack('t1', ['c1'], { kind: 'midi' });
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

            it('refuses when the track was frozen since capture', () => {
                // `frozen`, `frozenBufferId` and `freezeState` share one aggregate
                // comparator, so one case diverging all three (a real freeze moves
                // them together) is the falsifier for that whole entry.
                const track = liveTrack('t1', ['c1'], {
                    frozen: true,
                    frozenBufferId: 'buffer-frozen',
                    freezeState: { status: 'frozen', freezeId: 'freeze-1', frozenBufferId: 'buffer-frozen' },
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

            it('refuses when the active take lane switched since capture', () => {
                // Both lanes exist on both sides, so only the active-lane pointer
                // differs — the exact field `activeAlternativeId` compares and the
                // restore writes back.
                const lanes = () => [
                    { id: 'alt-1', name: 'Alternative 1', clips: [] as Clip[] },
                    { id: 'alt-2', name: 'Alternative 2', clips: [] as Clip[] },
                ];
                const track = liveTrack('t1', ['c1'], { alternatives: lanes(), activeAlternativeId: 'alt-2' });
                mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

                const result = handleRestoreTrackClipStates.execute({
                    type: 'restoreTrackClipStates',
                    payload: {
                        expected: [
                            snapshotFor('t1', ['c1'], {
                                trackFields: { ...trackFields(), alternatives: lanes() },
                            }),
                        ],
                        replacement: [snapshotFor('t1', [])],
                    },
                });

                expect(result).toEqual({ status: 'conflict' });
                expect(mocks.updateTrack).not.toHaveBeenCalled();
            });

            it('refuses when a take lane was replaced by another since capture', () => {
                // Same position, same name, same (empty) clips: only the lane's
                // identity differs, so the refusal can come only from
                // `ALTERNATIVE_FIELD_COMPARATORS.id`. A lane deleted and another
                // created keeps the count stable, which is why the length check
                // upstairs cannot catch this.
                const track = liveTrack('t1', ['c1'], {
                    alternatives: [
                        { id: 'alt-1', name: 'Alternative 1', clips: [] as Clip[] },
                        { id: 'alt-new', name: 'Take', clips: [] as Clip[] },
                    ],
                });
                mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

                const result = handleRestoreTrackClipStates.execute({
                    type: 'restoreTrackClipStates',
                    payload: {
                        expected: [
                            snapshotFor('t1', ['c1'], {
                                trackFields: {
                                    ...trackFields(),
                                    alternatives: [
                                        { id: 'alt-1', name: 'Alternative 1', clips: [] as Clip[] },
                                        { id: 'alt-old', name: 'Take', clips: [] as Clip[] },
                                    ],
                                },
                            }),
                        ],
                        replacement: [snapshotFor('t1', [])],
                    },
                });

                expect(result).toEqual({ status: 'conflict' });
                expect(mocks.updateTrack).not.toHaveBeenCalled();
            });

            it('refuses when CC events on a clip the snapshot carries were edited since capture', () => {
                // `midiCcByClipId` is its own guard key riding the shared lane
                // comparison; hollowing it alone leaves only this case noticing.
                const capturedCc = { id: 'cc-1', controller: 1, value: 10, beat: 0, channel: 0 };
                const editedCc = { ...capturedCc, value: 64 };
                mocks.getTrackStoreState.mockReturnValue({ tracks: [liveTrack('t1', ['c1'])] });
                mocks.midiStore.value = {
                    notesByClipId: {},
                    ccByClipId: { c1: [editedCc] },
                    pitchBendByClipId: {},
                };

                const result = handleRestoreTrackClipStates.execute({
                    type: 'restoreTrackClipStates',
                    payload: {
                        expected: [snapshotFor('t1', ['c1'], { midiCcByClipId: { c1: [capturedCc] } })],
                        replacement: [snapshotFor('t1', ['c1'])],
                    },
                });

                expect(result).toEqual({ status: 'conflict' });
                expect(mocks.updateTrack).not.toHaveBeenCalled();
                expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
            });

            it('refuses when pitch bend on a clip the snapshot carries was edited since capture', () => {
                // The third lane key, for the same reason as the CC case above.
                const capturedBend = { id: 'pb-1', value: 0, beat: 0, channel: 0 };
                const editedBend = { ...capturedBend, value: 4096 };
                mocks.getTrackStoreState.mockReturnValue({ tracks: [liveTrack('t1', ['c1'])] });
                mocks.midiStore.value = {
                    notesByClipId: {},
                    ccByClipId: {},
                    pitchBendByClipId: { c1: [editedBend] },
                };

                const result = handleRestoreTrackClipStates.execute({
                    type: 'restoreTrackClipStates',
                    payload: {
                        expected: [snapshotFor('t1', ['c1'], { midiPitchBendByClipId: { c1: [capturedBend] } })],
                        replacement: [snapshotFor('t1', ['c1'])],
                    },
                });

                expect(result).toEqual({ status: 'conflict' });
                expect(mocks.updateTrack).not.toHaveBeenCalled();
                expect(mocks.restoreMidiClipData).not.toHaveBeenCalled();
            });

            it('refuses when warp state the snapshot would overwrite was edited since capture', () => {
                // The satellite guard's other half. The gain-envelope case above proves
                // only that half; weakening the satellite comparison to the envelope it
                // already covers would leave warp edits unguarded and only this case
                // noticing.
                const capturedWarp = {
                    enabled: true,
                    markers: [],
                    stretchMode: 'complex' as const,
                    originalTempo: 120,
                };
                mocks.getTrackStoreState.mockReturnValue({ tracks: [liveTrack('t1', ['c1'])] });
                mocks.readClipSatelliteEntry.mockReturnValue({
                    clipId: 'c1',
                    gainEnvelope: null,
                    warpState: { ...capturedWarp, enabled: false },
                });

                const result = handleRestoreTrackClipStates.execute({
                    type: 'restoreTrackClipStates',
                    payload: {
                        expected: [
                            snapshotFor('t1', ['c1'], {
                                clipSatellites: [{ clipId: 'c1', gainEnvelope: null, warpState: capturedWarp }],
                            }),
                        ],
                        replacement: [snapshotFor('t1', ['c1'])],
                    },
                });

                expect(result).toEqual({ status: 'conflict' });
                expect(mocks.updateTrack).not.toHaveBeenCalled();
                expect(mocks.writeClipSatelliteEntry).not.toHaveBeenCalled();
            });
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
            const track = liveTrack('t1', ['c1']);
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
            const track = liveTrack('t1', ['c1']);
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
