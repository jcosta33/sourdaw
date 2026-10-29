import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { projectOfflineAudioClipPlaybacks } from '#/modules/AudioEngine/useCases/offlineRender/projectOfflineAudioClipPlaybacks';
import { resolveTrackClipsWithComping } from '#/modules/AudioEngine/useCases/offlineRender/resolveTrackClipsWithComping';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore as undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { readSecondsAtBeat, readTempoAtBeat, tempoMapStore } from '#/modules/Transport/stores';
import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type ResolvedClip } from '../../../models/ResolvedClip';
import { createTake, createTakeLane, type Take, type TakeLane } from '../../../models/TakeLane';
import { takeLaneStore, type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { trackStore, type TrackStoreState } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { resolveClipsWithComping } from '../../../useCases/resolveComping';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

type Project = {
    tracks: TrackStoreState;
    takeLanes: TakeLaneStoreState;
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

let stopProjectionBridge: () => void;

function arrangeLoopComp(): { lane: TakeLane; compTake: Take } {
    const passLength = 8;
    const clip = ClipDummy.create({
        id: 'source',
        trackId: 'track-1',
        type: 'audio',
        startBeat: 8,
        endBeat: 16,
        audioBufferId: 'source-buffer',
    });
    const passes = [
        createTake('source', 'Pass 1', 8, 16),
        createTake('source', 'Pass 2', 8, 16, passLength),
        createTake('source', 'Pass 3', 8, 16, passLength * 2),
    ];
    const compTake = passes[1]!;
    trackStore.set({
        tracks: [TrackDummy.create({ id: 'track-1', kind: 'audio', clips: [clip] })],
        selectedTrackId: 'track-1',
        ghostClips: [],
    });
    takeLaneStore.set({
        lanes: [
            {
                ...createTakeLane('track-1'),
                takes: passes,
                activeCompRegions: [{ startBeat: 8, endBeat: 16, takeId: compTake.id }],
            },
        ],
    });
    flushAutomergeStorageWrites();
    const lane = takeLaneStore.value?.lanes[0];
    if (!lane) {
        throw new Error('Expected the comp lane');
    }
    return { lane, compTake };
}

function expectAuthority(): void {
    flushAutomergeStorageWrites();
    const project = getCrdtDoc<Project>('root');
    if (!project) {
        throw new Error('Expected the project document');
    }
    if (!trackStore.value) {
        throw new Error('Expected the track store');
    }
    if (!takeLaneStore.value) {
        throw new Error('Expected the take lane store');
    }
    expect(project.tracks.tracks).toEqual(trackStore.value.tracks);
    expect(project.takeLanes.lanes).toEqual(takeLaneStore.value.lanes);
}

function lane(): TakeLane {
    const current = takeLaneStore.value?.lanes[0];
    if (!current) {
        throw new Error('Expected the comp lane');
    }
    return current;
}

function clips() {
    const track = trackStore.value?.tracks[0];
    if (!track) {
        throw new Error('Expected the arrangement track fixture');
    }
    return track.clips;
}

function capturedSource(startBeat: number, entrySeconds: number, loopLength: number) {
    return {
        startBeat,
        audioOffsetSeconds: entrySeconds,
        audioLoopStartSeconds: entrySeconds,
        audioLoopPassEntrySeconds: entrySeconds,
        audioLoopPassOriginBeat: startBeat,
        loopOriginBeat: startBeat,
        loopLength,
    };
}

/** Resolved comp fragments as plain rows: timeline span, media origin, media offset. */
function resolvedFragments(): number[][] {
    return resolveClipsWithComping('track-1', clips()).map((clip) => [
        clip.startBeat,
        clip.endBeat,
        clip.sourceStartBeat,
        clip.audioOffsetBeats ?? 0,
    ]);
}

const sampleRate = 48_000;
const frameAmplitudeScale = 2 ** 20;
// Every physical sample names its own frame, so a wrong entry cannot alias a
// periodic waveform or pass a live/offline comparison using the same mistake.
const sourcePcm = Float32Array.from({ length: 16 * sampleRate }, (_, frame) => frame / frameAmplitudeScale);

function arrangeFinitePlacedPass(rate: number, sourceEndSeconds: number): Take {
    const { compTake } = arrangeLoopComp();
    const state = trackStore.value;
    if (!state) {
        throw new Error('Expected the arrangement fixture');
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((track) => ({
            ...track,
            clips: track.clips.map((clip) => ({ ...clip, stretchMode: 'timestretch' as const, stretchRatio: rate })),
        })),
    });
    const selectedTake: Take = {
        ...compTake,
        passAnchorSeconds: 0,
        passDepthSeconds: 1,
        passSourceEndSeconds: sourceEndSeconds,
    };
    takeLaneStore.set({
        lanes: [{ ...lane(), takes: lane().takes.map((take) => (take.id === compTake.id ? selectedTake : take)) }],
    });
    flushAutomergeStorageWrites();
    return selectedTake;
}

function offlinePlaybacks(fragments: ResolvedClip[], startBeat: number) {
    return fragments.flatMap((clip) =>
        projectOfflineAudioClipPlaybacks({
            clip,
            bufferDurationSeconds: sourcePcm.length / sampleRate,
            regionStartBeat: startBeat,
            regionStartSec: readSecondsAtBeat({ beat: startBeat }),
            durationSeconds: 20,
            compensationDelay: 0,
            projectBeatToSeconds: (beat) => readSecondsAtBeat({ beat }),
            resolveTempoAtBeat: (beat) => readTempoAtBeat({ beat }),
        })
    );
}

function expectSourceEntry(beat: number, expectedSeconds: number): number {
    const live = resolveClipsWithComping('track-1', clips());
    const selected = live.find((clip) => clip.startBeat <= beat && beat < clip.endBeat);
    if (!selected) {
        throw new Error(`Expected selected audio at beat ${beat}`);
    }
    const rate = selected.stretchMode && selected.stretchMode !== 'off' ? (selected.stretchRatio ?? 1) : 1;
    // This is the bounded source window consumed by scheduleAudioClips.
    const [window] = projectAudioLoopPassSegments({
        clip: selected,
        loopLengthBeats: selected.loopLength ?? selected.endBeat - selected.startBeat,
        iterationStartBeat: beat,
        iterationEndBeat: Math.min(selected.endBeat, beat + 1 / 480),
        stretchRatio: rate,
        tempoAtClipStart: readTempoAtBeat({ beat: selected.startBeat }),
        secondsAtBeat: (atBeat) => readSecondsAtBeat({ beat: atBeat }),
    });
    const [offline] = offlinePlaybacks(resolveTrackClipsWithComping('track-1', clips()), beat);
    if (!window || !offline) {
        throw new Error(`Expected live and offline reads at beat ${beat}`);
    }
    expect(window.sourceStartSeconds).toBeCloseTo(expectedSeconds, 8);
    expect(offline.bufferOffsetSec).toBeCloseTo(expectedSeconds, 8);
    expect(offline.startSec).toBe(0);
    const expectedFrame = Math.round(expectedSeconds * sampleRate);
    const liveFrame = Math.round(window.sourceStartSeconds * sampleRate);
    expect(sourcePcm[liveFrame]).toBe(expectedFrame / frameAmplitudeScale);
    expect(sourcePcm[Math.round(offline.bufferOffsetSec * sampleRate)]).toBe(expectedFrame / frameAmplitudeScale);
    return liveFrame;
}

function expectFiniteFrontier(endBeat: number, sourceEndSeconds: number): void {
    const live = resolveClipsWithComping('track-1', clips());
    const offline = resolveTrackClipsWithComping('track-1', clips());
    expect(live.at(-1)?.endBeat).toBeCloseTo(endBeat, 8);
    expect(offline.at(-1)?.endBeat).toBeCloseTo(endBeat, 8);
    const lastRead = offlinePlaybacks(offline, 8).at(-1);
    if (!lastRead) {
        throw new Error('Expected the final finite pass read');
    }
    expect(lastRead.bufferOffsetSec + lastRead.playDuration * lastRead.playbackRate).toBeCloseTo(sourceEndSeconds, 8);
    expect(lastRead.rawIterEndSec).toBeCloseTo(readSecondsAtBeat({ beat: endBeat }), 8);
    expect(live.some((clip) => clip.startBeat <= endBeat && endBeat < clip.endBeat)).toBe(false);
    expect(offlinePlaybacks(offline, endBeat)).toEqual([]);
}

describe('Splitting a comped clip re-keys takes and comp regions onto both fragments', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('comp region split re-key integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        sessionStorage.removeItem('sourdaw-undo-session');
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        tempoMapStore.set({ changes: [{ id: 'fast', beat: 0, tempo: 120, curve: 'instant' }] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        stopProjectionBridge();
        configureAutomergeStoragePort(null);
        sessionStorage.removeItem('sourdaw-undo-session');
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('trim of a stretched finite selected pass retains the original PCM entry and frontier through undo and redo', async () => {
        const selectedTake = arrangeFinitePlacedPass(2, 5);
        const originalClips = structuredClone(clips());
        const originalLane = structuredClone(lane());
        expect(resolvedFragments()).toEqual([[8, 12, 7, 2]]);
        // At 120 BPM, beat 9 is 0.5 destination seconds after beat 8:
        // source depth 1 + 0.5 * rate 2 = source second 2 (frame 96,000).
        const originalFrame = expectSourceEntry(9, 2);
        expectFiniteFrontier(12, 5);

        await executeAppAction({ type: 'trimClipStart', payload: { clipId: 'source', newStartBeat: 9 } });

        expect(undoStore.value?.past).toHaveLength(1);
        expect(resolvedFragments()).toEqual([[9, 12, 7, 4]]);
        expect(expectSourceEntry(9, 2)).toBe(originalFrame);
        expectFiniteFrontier(12, 5);
        expect(lane().id).toBe(originalLane.id);
        expect(lane().trackId).toBe(originalLane.trackId);
        expect(lane().takes.map((take) => [take.id, take.clipId, take.startBeat, take.endBeat])).toEqual(
            originalLane.takes.map((take) => [take.id, take.clipId, take.startBeat, take.endBeat])
        );
        expect(lane().activeCompRegions.map((region) => [region.startBeat, region.endBeat, region.takeId])).toEqual(
            originalLane.activeCompRegions.map((region) => [region.startBeat, region.endBeat, region.takeId])
        );
        expect(lane().takes.find((take) => take.id === selectedTake.id)).toEqual(expect.objectContaining(selectedTake));
        const trimmedClips = structuredClone(clips());
        const trimmedLane = structuredClone(lane());
        expectAuthority();

        await undo();

        expect(clips()).toEqual(originalClips);
        expect(lane()).toEqual(originalLane);
        expect(resolvedFragments()).toEqual([[8, 12, 7, 2]]);
        expect(expectSourceEntry(9, 2)).toBe(originalFrame);
        expectFiniteFrontier(12, 5);
        expectAuthority();

        await redo();

        expect(clips()).toEqual(trimmedClips);
        expect(lane()).toEqual(trimmedLane);
        expect(resolvedFragments()).toEqual([[9, 12, 7, 4]]);
        expect(expectSourceEntry(9, 2)).toBe(originalFrame);
        expectFiniteFrontier(12, 5);
        expectAuthority();
    });

    it.each([
        { clock: 'tempo change', rate: 1, entrySeconds: 2.5, endBeat: 15.5, finalSourceSeconds: 8 },
        { clock: 'tempo change', rate: 2, entrySeconds: 4, endBeat: 12, finalSourceSeconds: 8 },
        { clock: 'flat tempo', rate: 1, entrySeconds: 2, endBeat: 16, finalSourceSeconds: 5 },
        { clock: 'flat tempo', rate: 2, entrySeconds: 3, endBeat: 15, finalSourceSeconds: 8 },
    ])(
        'split of a finite selected pass preserves PCM at rate $rate with $clock',
        async ({ clock, rate, entrySeconds, endBeat, finalSourceSeconds }) => {
            if (clock === 'tempo change') {
                tempoMapStore.set({
                    changes: [
                        { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                        { id: 'slow', beat: 9, tempo: 60, curve: 'instant' },
                    ],
                });
            }
            const selectedTake = arrangeFinitePlacedPass(rate, 8);
            const originalLane = structuredClone(lane());
            const originalClips = structuredClone(clips());
            expect(resolveClipsWithComping('track-1', clips())).toHaveLength(1);
            expectSourceEntry(8, 1);
            // The changing map spends 0.5 s before beat 9 and 1 s after it.
            // The flat control spends 1 s total; its rate-1 clip stops at
            // beat 16/source second 5 before the pass's source-second-8 bound.
            const originalFrame = expectSourceEntry(10, entrySeconds);
            expectFiniteFrontier(endBeat, finalSourceSeconds);

            await executeAppAction({ type: 'splitClip', payload: { clipId: 'source', beat: 10 } });

            expect(undoStore.value?.past).toHaveLength(1);
            const right = clips().find((clip) => clip.id !== 'source');
            if (!right) {
                throw new Error('Expected the right fragment of the finite pass');
            }
            const rightTakeId = `${selectedTake.id}:time-delete-right:10:10`;
            expect(lane().id).toBe(originalLane.id);
            expect(lane().takes.map((take) => [take.id, take.clipId, take.startBeat, take.endBeat])).toEqual(
                originalLane.takes.flatMap((take) => [
                    [take.id, 'source', 8, 10],
                    [`${take.id}:time-delete-right:10:10`, right.id, 10, 16],
                ])
            );
            expect(lane().activeCompRegions.map((region) => [region.startBeat, region.endBeat, region.takeId])).toEqual(
                [
                    [8, 10, selectedTake.id],
                    [10, 16, rightTakeId],
                ]
            );
            expect(lane().takes.find((take) => take.id === rightTakeId)).toEqual({
                ...selectedTake,
                id: rightTakeId,
                clipId: right.id,
                startBeat: 10,
                passOriginBeat: 8,
                passOriginSourceSeconds: 0,
            });
            expect(expectSourceEntry(10, entrySeconds)).toBe(originalFrame);
            expectFiniteFrontier(endBeat, finalSourceSeconds);
            const splitClips = structuredClone(clips());
            const splitLane = structuredClone(lane());
            expectAuthority();

            await undo();
            expect(clips()).toEqual(originalClips);
            expect(lane()).toEqual(originalLane);
            expect(expectSourceEntry(10, entrySeconds)).toBe(originalFrame);
            expectFiniteFrontier(endBeat, finalSourceSeconds);
            expectAuthority();

            await redo();
            expect(clips()).toEqual(splitClips);
            expect(lane()).toEqual(splitLane);
            expect(expectSourceEntry(10, entrySeconds)).toBe(originalFrame);
            expectFiniteFrontier(endBeat, finalSourceSeconds);
            expectAuthority();
        }
    );

    it('a stretched selected loop keeps its original repeat boundary across a tempo change and typed split', async () => {
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 9, tempo: 60, curve: 'instant' },
            ],
        });
        const { compTake } = arrangeLoopComp();
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected the loop fixture');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => ({
                    ...clip,
                    loopEnabled: true,
                    loopLength: 4,
                    stretchMode: 'timestretch' as const,
                    stretchRatio: 2,
                })),
            })),
        });
        flushAutomergeStorageWrites();
        const originalClips = structuredClone(clips());
        const originalLane = structuredClone(lane());
        // Pass 2 enters at source 4 s. The original repeat at beat 12 is
        // 3.5 destination seconds later, then resets to source 4 s again.
        const expectedEntries: [number, number][] = [
            [10, 7],
            [11.5, 10],
            [12, 4],
            [12.5, 5],
            [15.5, 11],
        ];
        const originalFrames = expectedEntries.map(([beat, seconds]) => expectSourceEntry(beat, seconds));
        const before = offlinePlaybacks(resolveTrackClipsWithComping('track-1', clips()), 8);
        expect(before.map((playback) => [playback.startSec, playback.bufferOffsetSec, playback.playDuration])).toEqual([
            [0, 4, 3.5],
            [3.5, 4, 4],
        ]);

        await executeAppAction({ type: 'splitClip', payload: { clipId: 'source', beat: 10 } });

        const right = clips().find((clip) => clip.id !== 'source');
        if (!right) {
            throw new Error('Expected the right fragment crossing the original repeat');
        }
        expect(lane().activeCompRegions.map((region) => [region.startBeat, region.endBeat, region.takeId])).toEqual([
            [8, 10, compTake.id],
            [10, 16, `${compTake.id}:time-delete-right:10:10`],
        ]);
        expect(lane().takes.find((take) => take.id === `${compTake.id}:time-delete-right:10:10`)?.clipId).toBe(
            right.id
        );
        expect(expectedEntries.map(([beat, seconds]) => expectSourceEntry(beat, seconds))).toEqual(originalFrames);
        const after = offlinePlaybacks(resolveTrackClipsWithComping('track-1', clips()), 8);
        expect(after.map((playback) => [playback.startSec, playback.bufferOffsetSec, playback.playDuration])).toEqual([
            [0, 4, 1.5],
            [1.5, 7, 2],
            [3.5, 4, 2],
            [5.5, 8, 2],
        ]);
        const splitClips = structuredClone(clips());
        const splitLane = structuredClone(lane());
        expectAuthority();

        await undo();
        expect(clips()).toEqual(originalClips);
        expect(lane()).toEqual(originalLane);
        expect(expectedEntries.map(([beat, seconds]) => expectSourceEntry(beat, seconds))).toEqual(originalFrames);
        expect(offlinePlaybacks(resolveTrackClipsWithComping('track-1', clips()), 8)).toEqual(before);
        expectAuthority();

        await redo();
        expect(clips()).toEqual(splitClips);
        expect(lane()).toEqual(splitLane);
        expect(expectedEntries.map(([beat, seconds]) => expectSourceEntry(beat, seconds))).toEqual(originalFrames);
        expect(offlinePlaybacks(resolveTrackClipsWithComping('track-1', clips()), 8)).toEqual(after);
        expectAuthority();
    });

    it('split at 14 keeps the comp sounding pass 2 across both fragments', async () => {
        const { lane: originalLane, compTake } = arrangeLoopComp();

        await executeAppAction({ type: 'splitClip', payload: { clipId: 'source', beat: 14 } });

        expect(undoStore.value?.past).toHaveLength(1);
        const rightClip = clips().find((clip) => clip.id !== 'source');
        if (!rightClip) {
            throw new Error('Expected the minted right fragment');
        }
        expect(clips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([
            ['source', 8, 14],
            [rightClip.id, 14, 16],
        ]);
        // Every pass take follows its clip: the left half keeps the take id
        // (the split convention), the right half mints the deterministic one.
        const mintedTakeId = `${compTake.id}:time-delete-right:14:14`;
        expect(lane().takes.map((take) => [take.id, take.clipId, take.startBeat, take.endBeat])).toEqual(
            originalLane.takes.flatMap((take) => [
                [take.id, 'source', 8, 14],
                [`${take.id}:time-delete-right:14:14`, rightClip.id, 14, 16],
            ])
        );
        expect(lane().activeCompRegions).toEqual([
            { startBeat: 8, endBeat: 14, takeId: compTake.id, audioSource: capturedSource(8, 4, 8) },
            { startBeat: 14, endBeat: 16, takeId: mintedTakeId, audioSource: capturedSource(8, 4, 8) },
        ]);
        // No audio changed: both fragments enter pass 2's media exactly where
        // the unsplit comp did — beats 14-16 keep sounding pass 2.
        expect(resolvedFragments()).toEqual([
            [8, 14, 0, 8],
            [14, 16, 6, 14],
        ]);
        expectAuthority();
    });

    it('split undo restores the whole comp exactly and redo re-fragments with stable take ids', async () => {
        const { lane: originalLane, compTake } = arrangeLoopComp();
        const mintedTakeId = `${compTake.id}:time-delete-right:14:14`;

        await executeAppAction({ type: 'splitClip', payload: { clipId: 'source', beat: 14 } });
        await undo();

        expect(clips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([['source', 8, 16]]);
        expect(lane()).toEqual(originalLane);
        expect(resolvedFragments()).toEqual([[8, 16, 0, 8]]);
        expectAuthority();

        await redo();
        const rightClip = clips().find((clip) => clip.id !== 'source');
        if (!rightClip) {
            throw new Error('Expected the re-minted right fragment');
        }
        expect(clips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([
            ['source', 8, 14],
            [rightClip.id, 14, 16],
        ]);
        expect(lane().takes.map((take) => take.id)).toContain(mintedTakeId);
        expect(lane().activeCompRegions).toEqual([
            { startBeat: 8, endBeat: 14, takeId: compTake.id, audioSource: capturedSource(8, 4, 8) },
            { startBeat: 14, endBeat: 16, takeId: mintedTakeId, audioSource: capturedSource(8, 4, 8) },
        ]);
        expect(resolvedFragments()).toEqual([
            [8, 14, 0, 8],
            [14, 16, 6, 14],
        ]);
        expectAuthority();
    });

    it('a take wholly left of the split rides verbatim while the comped take fragments', async () => {
        const arrange = arrangeLoopComp();
        const leftTake = createTake('source', 'Left comp', 8, 12);
        takeLaneStore.set({
            lanes: [
                {
                    ...lane(),
                    takes: [...lane().takes, leftTake],
                    activeCompRegions: [
                        { startBeat: 8, endBeat: 12, takeId: leftTake.id },
                        ...lane().activeCompRegions.map((region) =>
                            region.startBeat === 8 ? { ...region, startBeat: 12 } : region
                        ),
                    ],
                },
            ],
        });
        flushAutomergeStorageWrites();
        const compTake = arrange.compTake;

        await executeAppAction({ type: 'splitClip', payload: { clipId: 'source', beat: 14 } });

        const rightClip = clips().find((clip) => clip.id !== 'source');
        if (!rightClip) {
            throw new Error('Expected the minted right fragment');
        }
        // The left take never crosses the split: same id, same span, still
        // naming the (left) fragment clip id it always named.
        expect(lane().takes.find((take) => take.id === leftTake.id)).toEqual(leftTake);
        const mintedTakeId = `${compTake.id}:time-delete-right:14:14`;
        expect(lane().activeCompRegions).toEqual([
            { startBeat: 8, endBeat: 12, takeId: leftTake.id, audioSource: capturedSource(8, 0, 4) },
            { startBeat: 12, endBeat: 14, takeId: compTake.id, audioSource: capturedSource(12, 6, 4) },
            { startBeat: 14, endBeat: 16, takeId: mintedTakeId, audioSource: capturedSource(12, 6, 4) },
        ]);
        expect(resolvedFragments()).toEqual([
            [8, 12, 8, 0],
            [12, 14, 0, 12],
            [14, 16, 6, 14],
        ]);
        expectAuthority();
    });
});
