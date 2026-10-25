import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, takeLaneStore, type TakeLaneStoreState, trackStore } from '#/modules/Arrangement/stores';
import { normalizeTrack, resolveClipsWithComping, splitClip } from '#/modules/Arrangement/useCases';
import { readSecondsAtBeat, readTempoAtBeat, tempoMapStore } from '#/modules/Transport/stores';
import { projectPpqEndpoints } from '#/modules/Transport/useCases';
import { captureAudioSourceSnapshot } from '#/utils/audioSourceTime';

import { projectOfflineAudioClipPlaybacks } from '../projectOfflineAudioClipPlaybacks';
import { renderTempoTimeline } from '../renderTempoTimeline';
import { resolveTrackClipsWithComping } from '../resolveTrackClipsWithComping';

type Take = TakeLaneStoreState['lanes'][number]['takes'][number];
type TempoChange = NonNullable<typeof tempoMapStore.value>['changes'][number];

function recording(startBeat: number, endBeat: number, audioOffsetBeats?: number): Clip {
    const clip: Clip = {
        id: 'rec',
        trackId: 't1',
        name: 'Recording',
        startBeat,
        endBeat,
        type: 'audio',
        audioBufferId: 'rec-buf',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000',
        locked: false,
        muted: false,
    };
    if (audioOffsetBeats !== undefined) {
        clip.audioOffsetBeats = audioOffsetBeats;
    }
    return clip;
}

/**
 * A pass given in beats of the session's flat 120 BPM: its media depth, and,
 * when commit placed it, where it sounds from the clip's media origin. Commit
 * holds a placement in media seconds, two beats to the second.
 */
function pass(id: string, loop: readonly [number, number], depthBeats: number, anchorBeats?: number): Take {
    const take: Take = { id, clipId: 'rec', name: id, startBeat: loop[0], endBeat: loop[1], selected: false };
    take.sourceOffsetBeats = depthBeats;
    if (anchorBeats !== undefined) {
        take.passAnchorSeconds = anchorBeats / 2;
        take.passDepthSeconds = depthBeats / 2;
    }
    return take;
}

/** A pass as commit places it, in media seconds. */
function placedPass(id: string, loop: readonly [number, number], anchorSeconds: number, depthSeconds: number): Take {
    return {
        id,
        clipId: 'rec',
        name: id,
        startBeat: loop[0],
        endBeat: loop[1],
        selected: false,
        sourceOffsetBeats: 0,
        passAnchorSeconds: anchorSeconds,
        passDepthSeconds: depthSeconds,
    };
}

function lane(takes: Take[], takeId: string, startBeat: number, endBeat: number): TakeLaneStoreState {
    return {
        lanes: [{ id: 'lane-1', trackId: 't1', takes, activeCompRegions: [{ startBeat, endBeat, takeId }] }],
    };
}

const loopPasses = (anchorBeats?: number) => [
    pass('pass-1', [0, 4], 0, anchorBeats),
    pass('pass-2', [0, 4], 4, anchorBeats),
];

const cases: readonly { name: string; state: TakeLaneStoreState; clip: Clip }[] = [
    { name: 'as recorded', state: lane(loopPasses(0), 'pass-2', 0, 4), clip: recording(0, 12) },
    { name: 'moved away from the comp', state: lane(loopPasses(0), 'pass-2', 0, 4), clip: recording(8, 20) },
    { name: 'moved under the comp', state: lane(loopPasses(0), 'pass-2', 8, 12), clip: recording(8, 20) },
    { name: 'slipped', state: lane(loopPasses(0), 'pass-2', 0, 4), clip: recording(0, 12, 1) },
    { name: 'start trimmed', state: lane(loopPasses(0), 'pass-2', 0, 4), clip: recording(2, 12, 2) },
    {
        name: 'recorded inside the loop',
        state: lane([pass('pass-2', [8, 16], 4, -4)], 'pass-2', 8, 16),
        clip: recording(8, 24, -4),
    },
    {
        name: 'recorded inside the loop, first pass comped',
        state: lane([pass('pass-1', [12, 16], 0, 0)], 'pass-1', 8, 16),
        clip: recording(8, 24, -4),
    },
    {
        name: 'recorded inside the loop, then slipped',
        state: lane([pass('pass-2', [8, 16], 4, -4)], 'pass-2', 8, 16),
        clip: recording(8, 24, -3),
    },
    {
        name: 'placed before a clip opening on the record point',
        state: lane([pass('pass-2', [8, 16], 4, -4)], 'pass-2', 8, 16),
        clip: recording(12, 24),
    },
    {
        name: 'saved before pass placement existed, content slipped later',
        state: lane(loopPasses(), 'pass-2', 0, 4),
        clip: recording(0, 12, -2),
    },
    {
        name: 'recorded inside the loop, then trimmed',
        state: lane([pass('pass-2', [8, 16], 4, -4)], 'pass-2', 8, 16),
        clip: recording(14, 24, 2),
    },
    {
        name: 'run-up with capture latency',
        state: lane([pass('pass-2', [2, 6], 5.5, 1.5)], 'pass-2', 2, 6),
        clip: recording(0.5, 10),
    },
    {
        name: 'saved before pass placement existed',
        state: lane(loopPasses(), 'pass-2', 0, 4),
        clip: recording(1, 12, 1),
    },
];

function audioSourceIntervals(clips: readonly Clip[]) {
    const intervals = clips
        .flatMap((clip) =>
            projectOfflineAudioClipPlaybacks({
                clip,
                bufferDurationSeconds: 40,
                regionStartBeat: 0,
                regionStartSec: 0,
                durationSeconds: 40,
                compensationDelay: 0,
                projectBeatToSeconds: (beat) => beat / 2,
                resolveTempoAtBeat: () => 120,
            }).map(({ startSec, bufferOffsetSec, playDuration, playbackRate }) => ({
                timelineStart: Math.round(startSec * 48000),
                timelineEnd: Math.round((startSec + playDuration) * 48000),
                sourceStart: Math.round(bufferOffsetSec * 48000),
                sourceEnd: Math.round((bufferOffsetSec + playDuration * playbackRate) * 48000),
                playbackRate,
            }))
        )
        .sort((left, right) => left.timelineStart - right.timelineStart);
    const joined: typeof intervals = [];
    for (const interval of intervals) {
        const previous = joined.at(-1);
        if (
            previous &&
            previous.timelineEnd === interval.timelineStart &&
            previous.sourceEnd === interval.sourceStart &&
            previous.playbackRate === interval.playbackRate
        ) {
            previous.timelineEnd = interval.timelineEnd;
            previous.sourceEnd = interval.sourceEnd;
        } else joined.push({ ...interval });
    }
    return joined;
}

describe('split looped comp source preservation', () => {
    it.each([false, true])(
        'keeps placed eligibility authoritative after splitting and changing rate with prior region snapshot %s',
        (withSnapshot) => {
            tempoMapStore.set({ changes: [{ id: 'flat', beat: 0, tempo: 120, curve: 'instant' }] });
            const clip: Clip = {
                ...recording(17, 30, 17),
                audioOffsetSeconds: 8.5,
                audioUnwrappedOffsetSeconds: 8.5,
                stretchMode: 'timestretch',
                stretchRatio: 2,
            };
            const take = {
                ...placedPass('placed', [17, 30], 10.5, 2),
                passSourceEndSeconds: 6,
                passOriginBeat: 17,
                passOriginSourceSeconds: 8.5,
            };
            const state = lane([take], take.id, 17, 30);
            takeLaneStore.set(state);
            const oldFragment = resolveClipsWithComping('t1', [clip])[0]!;
            expect(oldFragment.startBeat).toBe(19);
            expect(oldFragment.audioOffsetSeconds).toBe(2);
            const source = captureAudioSourceSnapshot(oldFragment, oldFragment.endBeat - oldFragment.startBeat, 120);
            expect(source).not.toBeNull();
            if (withSnapshot) {
                state.lanes[0]!.activeCompRegions[0]!.audioSource = source!;
                takeLaneStore.set(state);
            }
            const track = { ...normalizeTrack({ id: 't1', name: 'Audio', kind: 'audio' }), clips: [clip] };
            trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
            expect(splitClip(clip.id, 18, 'right-placed')).toBe('right-placed');
            const clips = trackStore.value!.tracks[0]!.clips.map((part) => ({ ...part, stretchRatio: 1 }));
            const current = takeLaneStore.value!;
            const live = resolveClipsWithComping('t1', clips);
            const offline = resolveTrackClipsWithComping('t1', clips, current);
            for (const programme of [live, offline]) {
                const projected = audioSourceIntervals(programme);
                expect(projected).toEqual([
                    {
                        timelineStart: 21 * 24000,
                        timelineEnd: 29 * 24000,
                        sourceStart: 2 * 48000,
                        sourceEnd: 6 * 48000,
                        playbackRate: 1,
                    },
                ]);
            }
            expect(offline).toEqual(live);
            if (withSnapshot)
                expect(current.lanes[0]!.activeCompRegions.every((region) => region.audioSource)).toBe(true);
            else
                expect(current.lanes[0]!.activeCompRegions.every((region) => region.audioSource === undefined)).toBe(
                    true
                );
        }
    );

    it('plays preserved base-gap source windows with no active comp regions or takes', () => {
        const clip: Clip = {
            ...recording(0, 12),
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: 0,
            stretchMode: 'timestretch',
            stretchRatio: 2,
            audioOffsetSeconds: 0,
            audioLoopStartSeconds: 0,
            audioLoopPassEntrySeconds: 0,
            audioLoopPassOriginBeat: 0,
        };
        const tiledLane = {
            id: 'lane-1',
            trackId: 't1',
            takes: [],
            activeCompRegions: [],
            baseGapAudioSources: [
                {
                    clipId: clip.id,
                    startBeat: 1,
                    endBeat: 11,
                    audioSource: {
                        startBeat: 1,
                        audioOffsetSeconds: 0.5,
                        audioLoopStartSeconds: 0,
                        audioLoopPassEntrySeconds: 0.5,
                        audioLoopPassOriginBeat: 1,
                        loopOriginBeat: 0,
                        loopLength: 4,
                    },
                },
            ],
        };
        takeLaneStore.set({ lanes: [tiledLane] });
        const expected = [
            { timelineStart: 0, timelineEnd: 24000, sourceStart: 0, sourceEnd: 48000, playbackRate: 2 },
            { timelineStart: 24000, timelineEnd: 96000, sourceStart: 24000, sourceEnd: 168000, playbackRate: 2 },
            { timelineStart: 96000, timelineEnd: 120000, sourceStart: 0, sourceEnd: 48000, playbackRate: 2 },
            { timelineStart: 120000, timelineEnd: 192000, sourceStart: 24000, sourceEnd: 168000, playbackRate: 2 },
            { timelineStart: 192000, timelineEnd: 216000, sourceStart: 0, sourceEnd: 48000, playbackRate: 2 },
            { timelineStart: 216000, timelineEnd: 264000, sourceStart: 24000, sourceEnd: 120000, playbackRate: 2 },
            { timelineStart: 264000, timelineEnd: 288000, sourceStart: 144000, sourceEnd: 192000, playbackRate: 2 },
        ];
        expect(audioSourceIntervals(resolveClipsWithComping('t1', [clip]))).toEqual(expected);
        expect(audioSourceIntervals(resolveTrackClipsWithComping('t1', [clip]))).toEqual(expected);
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        tempoMapStore.set({ changes: [] });
    });

    it.each([4, undefined])(
        'keeps selected source intervals and region seams through re-key with period %s',
        (period) => {
            tempoMapStore.set({ changes: [] });
            const clip: Clip = {
                ...recording(0, 12),
                loopEnabled: true,
                ...(period === undefined ? {} : { loopLength: period }),
                loopOriginBeat: 0,
                stretchMode: 'timestretch',
                stretchRatio: 2,
            };
            const track = normalizeTrack({ id: 't1', name: 'Audio', kind: 'audio', clips: [clip] });
            trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
            const selected = pass('selected', [0, 12], 4);
            takeLaneStore.set(lane([selected], selected.id, 1, 11));
            const before = audioSourceIntervals(resolveClipsWithComping('t1', [clip]));
            expect(audioSourceIntervals(resolveTrackClipsWithComping('t1', [clip]))).toEqual(before);
            expect(before).toContainEqual({
                timelineStart: 24000,
                timelineEnd: period === undefined ? 264000 : 120000,
                sourceStart: 120000,
                sourceEnd: period === undefined ? 600000 : 312000,
                playbackRate: 2,
            });

            expect(splitClip(clip.id, 2, 'right')).toBe('right');

            const fragments = trackStore.value!.tracks[0]!.clips;
            expect(audioSourceIntervals(resolveClipsWithComping('t1', fragments))).toEqual(before);
            expect(audioSourceIntervals(resolveTrackClipsWithComping('t1', fragments))).toEqual(before);
        }
    );

    it('keeps independent source grids for two regions selecting the same take', () => {
        const clip: Clip = {
            ...recording(0, 12),
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: 0,
            stretchMode: 'timestretch',
            stretchRatio: 2,
        };
        const track = normalizeTrack({ id: 't1', name: 'Audio', kind: 'audio', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        const selected = pass('selected', [0, 12], 4);
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [selected],
                    activeCompRegions: [
                        { startBeat: 1, endBeat: 3, takeId: selected.id },
                        { startBeat: 7, endBeat: 11, takeId: selected.id },
                    ],
                },
            ],
        });
        const before = audioSourceIntervals(resolveClipsWithComping('t1', [clip]));
        expect(before).toContainEqual({
            timelineStart: 24000,
            timelineEnd: 72000,
            sourceStart: 120000,
            sourceEnd: 216000,
            playbackRate: 2,
        });
        expect(before).toContainEqual({
            timelineStart: 168000,
            timelineEnd: 264000,
            sourceStart: 264000,
            sourceEnd: 456000,
            playbackRate: 2,
        });
        expect(splitClip(clip.id, 2, 'right')).toBe('right');
        const fragments = trackStore.value!.tracks[0]!.clips;
        expect(audioSourceIntervals(resolveClipsWithComping('t1', fragments))).toEqual(before);
        expect(audioSourceIntervals(resolveTrackClipsWithComping('t1', fragments))).toEqual(before);
    });

    it.each([
        { depth: 0, legacy: 4 },
        { depth: 1.25, legacy: undefined },
    ])('reads authoritative take source seconds $depth with legacy depth $legacy', ({ depth, legacy }) => {
        const clip = recording(0, 4);
        const selected: Take = {
            id: 'selected',
            clipId: clip.id,
            name: 'Selected',
            startBeat: 0,
            endBeat: 4,
            selected: false,
            sourceOffsetSeconds: depth,
            ...(legacy === undefined ? {} : { sourceOffsetBeats: legacy }),
        };
        takeLaneStore.set(lane([selected], selected.id, 0, 4));
        const expected = [
            {
                timelineStart: 0,
                timelineEnd: 96000,
                sourceStart: depth * 48000,
                sourceEnd: (depth + 2) * 48000,
                playbackRate: 1,
            },
        ];
        expect(audioSourceIntervals(resolveClipsWithComping('t1', [clip]))).toEqual(expected);
        expect(audioSourceIntervals(resolveTrackClipsWithComping('t1', [clip]))).toEqual(expected);
    });

    it.each([2, 4.5])(
        'keeps first entry, reset and repeat when splitting a stretched legacy loop at %s',
        (splitBeat) => {
            tempoMapStore.set({ changes: [] });
            const clip: Clip = {
                ...recording(1, 9, 1),
                loopEnabled: true,
                loopLength: 4,
                loopOriginBeat: 0,
                stretchMode: 'timestretch',
                stretchRatio: 2,
            };
            const track = normalizeTrack({ id: 't1', name: 'Audio', kind: 'audio', clips: [clip] });
            trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
            takeLaneStore.set({ lanes: [] });
            const before = audioSourceIntervals([clip]);
            expect(before).toEqual([
                { timelineStart: 24000, timelineEnd: 96000, sourceStart: 24000, sourceEnd: 168000, playbackRate: 2 },
                { timelineStart: 96000, timelineEnd: 120000, sourceStart: 0, sourceEnd: 48000, playbackRate: 2 },
                { timelineStart: 120000, timelineEnd: 192000, sourceStart: 24000, sourceEnd: 168000, playbackRate: 2 },
                { timelineStart: 192000, timelineEnd: 216000, sourceStart: 0, sourceEnd: 48000, playbackRate: 2 },
            ]);
            expect(splitClip(clip.id, splitBeat, 'right')).toBe('right');
            expect(audioSourceIntervals(trackStore.value!.tracks[0]!.clips)).toEqual(before);
        }
    );
});

describe('split audio loop source compatibility', () => {
    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        tempoMapStore.set({ changes: [] });
    });

    it.each([false, true])('preserves every played loop window when canonical entry is %s', (canonical) => {
        tempoMapStore.set({ changes: [] });
        const clip: Clip = {
            ...recording(1, 13, 1),
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: 0,
            stretchMode: 'timestretch',
            stretchRatio: 2,
            ...(canonical ? { audioOffsetSeconds: 0.5, audioLoopStartSeconds: 0 } : {}),
        };
        const track = normalizeTrack({ id: 't1', name: 'Audio', kind: 'audio', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        const project = (clips: readonly Clip[]) =>
            clips
                .flatMap((fragment) =>
                    projectOfflineAudioClipPlaybacks({
                        clip: fragment,
                        bufferDurationSeconds: 40,
                        regionStartBeat: 0,
                        regionStartSec: 0,
                        durationSeconds: 40,
                        compensationDelay: 0,
                        projectBeatToSeconds: (beat) => beat / 2,
                        resolveTempoAtBeat: () => 120,
                    }).map(({ startSec, bufferOffsetSec, playDuration, playbackRate }) => ({
                        startSec,
                        bufferOffsetSec,
                        playDuration,
                        playbackRate,
                    }))
                )
                .sort((left, right) => left.startSec - right.startSec);
        const before = project([clip]);

        expect(splitClip(clip.id, 5, 'right')).toBe('right');

        expect(project(trackStore.value!.tracks[0]!.clips)).toEqual(before);
    });
});

describe('live and offline comp resolution', () => {
    afterEach(() => {
        takeLaneStore.set({ lanes: [] });
    });

    it.each(cases)('resolve the same fragments for a pass $name', ({ state, clip }) => {
        takeLaneStore.set(state);
        expect(takeLaneStore.value).toEqual(state);

        const live = resolveClipsWithComping('t1', [clip]);
        const offline = resolveTrackClipsWithComping('t1', [clip], state);

        expect(offline).toEqual(live);
        expect(live.length).toBeGreaterThan(0);
    });
});

/** 120 BPM, dropping to 60 at `beat`. */
function dropTo60At(beat: number): TempoChange[] {
    return [
        { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
        { id: `tempo-${beat}`, beat, tempo: 60, curve: 'instant' },
    ];
}

// Takes as the commit places them across a tempo change, with the project's
// tempo map in force. Every offset is media seconds × the tempo at the
// fragment's own first beat / 60, the unit the readers seek in: a fragment
// must enter at the seconds the capture had run when what it plays sounded.
describe('live and offline comp resolution across a tempo change', () => {
    afterEach(() => {
        takeLaneStore.set({ lanes: [] });
        tempoMapStore.set({ changes: [] });
    });

    /** Begun at 12 inside loop [8,16), capture from 6.98 s: the clip opens at 8 entering −2.98 s at 120 BPM. */
    const insideLoop = recording(8, 30, -5.96);

    it.each([
        {
            // Recorded from 12 with one bar of pre-roll (capture from 3.98 s)
            // into loop [16,24). The clip opens at 12, entering 2.02 s in;
            // pass 2 began 14.02 s into the capture, read at 60 BPM.
            name: 'a run-up pass across the drop',
            tempoChanges: dropTo60At(12),
            state: lane([placedPass('pass-2', [16, 24], 6.02, 14.02)], 'pass-2', 16, 24),
            clip: recording(12, 32, 2.02),
            entry: { startBeat: 16, audioOffsetBeats: 14.02 },
        },
        {
            // Pass 2 began 4.02 s into the capture, read at 120 BPM.
            name: 'pass 2 of a recording begun inside the loop',
            tempoChanges: dropTo60At(10),
            state: lane([placedPass('pass-2', [8, 16], -2.98, 4.02)], 'pass-2', 8, 16),
            clip: insideLoop,
            entry: { startBeat: 8, audioOffsetBeats: 8.04 },
        },
        {
            // Its first pass sounds from the record point, 0.02 s in at 60 BPM.
            name: 'pass 1 of a recording begun inside the loop',
            tempoChanges: dropTo60At(10),
            state: lane([placedPass('pass-1', [12, 16], 0.02, 0.02)], 'pass-1', 8, 16),
            clip: insideLoop,
            entry: { startBeat: 12, audioOffsetBeats: 0.02 },
        },
        {
            // Pass 3 began 11.02 s into the capture, read at 120 BPM.
            name: 'pass 3 of a recording begun inside the loop',
            tempoChanges: dropTo60At(10),
            state: lane([placedPass('pass-3', [8, 16], -2.98, 11.02)], 'pass-3', 8, 16),
            clip: insideLoop,
            entry: { startBeat: 8, audioOffsetBeats: 22.04 },
        },
        {
            // Comped over [8,12), the clip shows through from 12, where the
            // capture had run 0.02 s, read at 60 BPM.
            name: 'the clip filling in after a comp ending past the drop',
            tempoChanges: dropTo60At(10),
            state: lane([placedPass('pass-2', [8, 16], -2.98, 4.02)], 'pass-2', 8, 12),
            clip: insideLoop,
            entry: { startBeat: 12, audioOffsetBeats: 0.02 },
        },
        {
            // Comped from 12, pass 2 enters at 7.02 s, read at 60 BPM.
            name: 'pass 2 comped from after the drop',
            tempoChanges: dropTo60At(10),
            state: lane([placedPass('pass-2', [8, 16], -2.98, 4.02)], 'pass-2', 12, 16),
            clip: insideLoop,
            entry: { startBeat: 12, audioOffsetBeats: 7.02 },
        },
        {
            // Begun at the loop start, 8, with the drop at 12 inside the loop
            // (capture from 3.98 s, the clip on its origin at 7.96). Comped
            // from 13, pass 2 enters at 9.02 s, read at 60 BPM.
            name: 'pass 2 of a recording begun at the loop start, comped from after the drop',
            tempoChanges: dropTo60At(12),
            state: lane([placedPass('pass-2', [8, 16], 0.02, 6.02)], 'pass-2', 13, 16),
            clip: recording(7.96, 24),
            entry: { startBeat: 13, audioOffsetBeats: 9.02 },
        },
    ])('enter $name where the capture recorded it', ({ tempoChanges, state, clip, entry }) => {
        tempoMapStore.set({ changes: tempoChanges });
        takeLaneStore.set(state);

        const live = resolveClipsWithComping('t1', [clip]);
        const offline = resolveTrackClipsWithComping('t1', [clip], state);

        expect(offline).toEqual(live);
        const entered = offline.find((fragment) => fragment.startBeat === entry.startBeat);
        expect(entered?.audioOffsetBeats).toBeCloseTo(entry.audioOffsetBeats, 9);
    });

    it('leaves a fragment on its clip’s own offset byte-identical to the clip', () => {
        tempoMapStore.set({ changes: dropTo60At(10) });
        const state = lane([placedPass('pass-2', [8, 16], -2.98, 4.02)], 'pass-2', 12, 16);
        takeLaneStore.set(state);

        const live = resolveClipsWithComping('t1', [insideLoop]);
        const offline = resolveTrackClipsWithComping('t1', [insideLoop], state);

        // The clip shows through from its own start, [8,12).
        const { regionStartBeat, regionEndBeat, sourceStartBeat, ...gap } = live[0]!;
        expect([regionStartBeat, regionEndBeat, sourceStartBeat]).toEqual([8, 12, 8]);
        expect({ ...gap, endBeat: insideLoop.endBeat }).toStrictEqual(insideLoop);
        expect(offline[0]?.audioOffsetBeats).toBe(insideLoop.audioOffsetBeats);
    });

    // Pass 1 of the recording begun inside the loop sounds from the record
    // point, 0.02 s into the clip's media. Whatever moves or slips the clip's
    // content carries the pass with it, so it starts where the content reaches
    // 0.02 s and enters there.
    it.each([
        {
            // Slipped a beat later into the media at 120 BPM: the content now
            // reaches 0.02 s half a second sooner, at 11.5.
            name: 'slipped',
            clip: recording(8, 30, -4.96),
            entry: { startBeat: 11.5, audioOffsetBeats: 0.02 },
        },
        {
            // Moved to 6: the content reaches 0.02 s at 11, one second sooner
            // at 60 BPM, two beats sooner at 120.
            name: 'moved',
            clip: recording(6, 28, -5.96),
            entry: { startBeat: 11, audioOffsetBeats: 0.02 },
        },
    ])('carries a placed pass with its $name clip across the drop', ({ clip, entry }) => {
        tempoMapStore.set({ changes: dropTo60At(10) });
        const state = lane([placedPass('pass-1', [12, 16], 0.02, 0.02)], 'pass-1', 8, 16);
        takeLaneStore.set(state);

        const live = resolveClipsWithComping('t1', [clip]);
        const offline = resolveTrackClipsWithComping('t1', [clip], state);

        expect(offline).toEqual(live);
        // The region claims [8,16), so the pass is the first thing that sounds in it.
        const entered = offline.find((fragment) => fragment.startBeat >= 8);
        expect(entered?.startBeat).toBeCloseTo(entry.startBeat, 9);
        expect(entered?.audioOffsetBeats).toBeCloseTo(entry.audioOffsetBeats, 9);
    });

    describe('for a MIDI clip, whose notes are placed in beats', () => {
        const midi: Clip = {
            id: 'rec',
            trackId: 't1',
            name: 'Recording',
            startBeat: 8,
            endBeat: 24,
            type: 'midi',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#000',
            locked: false,
            muted: false,
        };

        it('adds beats to its offsets across the drop', () => {
            tempoMapStore.set({ changes: dropTo60At(10) });
            const state = lane([pass('pass-2', [8, 16], 4)], 'pass-2', 12, 16);
            takeLaneStore.set(state);

            const live = resolveClipsWithComping('t1', [midi]);
            const offline = resolveTrackClipsWithComping('t1', [midi], state);

            expect(offline).toEqual(live);
            // Main's law: the pass enters 4 beats deep plus its 4 from the clip
            // start; the clip shows through from 16, 8 beats into its notes.
            expect(live.map((fragment) => [fragment.startBeat, fragment.midiOffsetBeats ?? 0])).toStrictEqual([
                [8, 0],
                [12, 8],
                [16, 8],
            ]);
        });
    });
});

describe('captured pass source endings', () => {
    afterEach(() => {
        takeLaneStore.set({ lanes: [] });
        tempoMapStore.set({ changes: [] });
    });

    it('retains source frames 43680 through 57600 with a floating capture depth on a constant sample grid', () => {
        tempoMapStore.set({ changes: [{ id: 'flat', beat: 0, tempo: 120, curve: 'instant' }] });
        const sampleRate = 48000;
        const clip = recording(8, 12, -2.179999999999998);
        const take = {
            ...placedPass('floating-depth', [8, 8.579999999999991], -1.089999999999999, 0.9100000000000037),
            passSourceEndSeconds: 1.2,
        };
        const state = lane([take], take.id, 8, 8.58);
        takeLaneStore.set(state);
        const secondsAtBeat = (beat: number) => Math.round((beat / 2) * sampleRate) / sampleRate;
        const offline = resolveTrackClipsWithComping(
            't1',
            [clip],
            state,
            renderTempoTimeline(secondsAtBeat, () => 120)
        );
        const live = resolveClipsWithComping('t1', [clip]);
        const pcm = Float32Array.from({ length: 57600 }, (_value, frame) => frame);
        for (const fragments of [live, offline]) {
            const selected = fragments.find((fragment) => fragment.regionStartBeat === 8)!;
            expect(selected).toBeDefined();
            expect(selected.regionEndBeat).toBeCloseTo(8.58, 10);
            const [playback] = projectOfflineAudioClipPlaybacks({
                clip: selected,
                bufferDurationSeconds: 1.2,
                regionStartBeat: 8,
                regionStartSec: 4,
                durationSeconds: 2,
                compensationDelay: 0,
                projectBeatToSeconds: secondsAtBeat,
                resolveTempoAtBeat: () => 120,
            });
            expect(playback).toBeDefined();
            expect(playback!.bufferOffsetSec).toBe(0.9100000000000037);
            const entry = Math.round(playback!.bufferOffsetSec * sampleRate);
            const end = Math.round(
                (playback!.bufferOffsetSec + playback!.playDuration * playback!.playbackRate) * sampleRate
            );
            expect(entry).toBe(43680);
            expect(end).toBe(57600);
            expect(end - entry).toBe(13920);
            expect(pcm[entry]).toBe(43680);
            expect(pcm[end - 1]).toBe(57599);
            expect(pcm[end]).toBeUndefined();
        }
    });

    it.each([0, 0.25])('retains every captured frame through a short tempo drop when comp entry is %s', (compStart) => {
        const changes: TempoChange[] = [
            { id: 'fast', beat: 0, tempo: 180, curve: 'instant' },
            { id: 'slow', beat: 0.25, tempo: 60, curve: 'instant' },
            { id: 'fast-again', beat: 0.5, tempo: 180, curve: 'instant' },
        ];
        tempoMapStore.set({ changes });
        const sampleRate = 48000;
        const sourceEnd = readSecondsAtBeat({ beat: 0.34 });
        // Independently integrated: .25 / 3 + (.34 - .25), exactly 8320 frames.
        expect(Math.round(sourceEnd * sampleRate)).toBe(8320);
        const clip = recording(0, 2);
        const take = { ...placedPass('bounded', [0, 0.34], 0, 0), passSourceEndSeconds: sourceEnd };
        const state = lane([take], take.id, compStart, 0.34);
        takeLaneStore.set(state);
        // This is the actual whole-sample placement read used by both exports.
        const secondsAtBeat = (beat: number) =>
            projectPpqEndpoints({
                startPpq: beat,
                endPpq: beat,
                defaultTempo: 120,
                sampleRate,
                changes,
            }).startSeconds;
        const tempoAtBeat = (beat: number) => readTempoAtBeat({ beat });
        const live = resolveClipsWithComping('t1', [clip]);
        const offline = resolveTrackClipsWithComping(
            't1',
            [clip],
            state,
            renderTempoTimeline(secondsAtBeat, tempoAtBeat)
        );
        const pcm = Float32Array.from({ length: 8320 }, (_value, frame) => frame);
        const firstFrame = compStart === 0 ? 0 : 4000;
        for (const fragments of [live, offline]) {
            const selected = fragments.find((fragment) => fragment.regionStartBeat === compStart)!;
            expect(selected).toBeDefined();
            expect(selected.regionStartBeat).toBe(compStart);
            expect(Math.round(secondsAtBeat(selected.regionEndBeat) * sampleRate)).toBe(8320);
            const [playback] = projectOfflineAudioClipPlaybacks({
                clip: selected,
                bufferDurationSeconds: 2,
                regionStartBeat: compStart,
                regionStartSec: secondsAtBeat(compStart),
                durationSeconds: 2,
                compensationDelay: 0,
                projectBeatToSeconds: secondsAtBeat,
                resolveTempoAtBeat: tempoAtBeat,
            });
            expect(playback).toBeDefined();
            const entry = Math.round(playback!.bufferOffsetSec * sampleRate);
            const end = Math.round(
                (playback!.bufferOffsetSec + playback!.playDuration * playback!.playbackRate) * sampleRate
            );
            expect(playback!.playbackRate).toBe(1);
            expect(entry).toBe(firstFrame);
            expect(end - entry).toBe(8320 - firstFrame);
            expect(end).toBe(8320);
            expect(pcm[entry]).toBe(firstFrame);
            expect(pcm[end - 1]).toBe(8319);
            expect(pcm[end]).toBeUndefined();
        }
    });

    it.each([
        { ratio: 2, anchorBeat: 12.2, endpointBeat: 12.6 },
        { ratio: 0.5, anchorBeat: 12.8, endpointBeat: 14.4 },
    ])('maps source anchors and later comp entry at playback rate $ratio', ({ ratio, anchorBeat, endpointBeat }) => {
        tempoMapStore.set({ changes: [{ id: 'tempo', beat: 0, tempo: 120, curve: 'instant' }] });
        const clip = { ...recording(12, 20, 0.2), stretchMode: 'timestretch' as const, stretchRatio: ratio };
        const take = { ...placedPass('bounded', [12, 16], 0.3, 0.1), passSourceEndSeconds: 0.5 };
        const compStart = anchorBeat + 0.1;
        const state = lane([take], take.id, compStart, 16);
        takeLaneStore.set(state);
        const live = resolveClipsWithComping('t1', [clip]);
        expect(resolveTrackClipsWithComping('t1', [clip], state)).toEqual(live);
        const selected = live.find((fragment) => fragment.regionStartBeat === compStart)!;
        expect(selected.regionEndBeat).toBeCloseTo(endpointBeat, 10);
        const [playback] = projectOfflineAudioClipPlaybacks({
            clip: selected,
            bufferDurationSeconds: 2,
            regionStartBeat: 12,
            regionStartSec: 6,
            durationSeconds: 8,
            compensationDelay: 0,
            projectBeatToSeconds: (beat) => beat / 2,
            resolveTempoAtBeat: () => 120,
        });
        expect(playback!.startSec).toBeCloseTo((compStart - 12) / 2, 10);
        expect(playback!.bufferOffsetSec).toBeCloseTo(0.1 + 0.05 * ratio, 10);
        expect(playback!.bufferOffsetSec + playback!.playDuration * playback!.playbackRate).toBeCloseTo(0.5, 10);
        const unavailable = lane([take], take.id, endpointBeat, 16);
        takeLaneStore.set(unavailable);
        expect(
            resolveClipsWithComping('t1', [clip]).some(
                (fragment) => fragment.regionStartBeat >= endpointBeat && fragment.regionStartBeat < 16
            )
        ).toBe(false);
        expect(resolveTrackClipsWithComping('t1', [clip], unavailable)).toEqual(resolveClipsWithComping('t1', [clip]));
    });

    it.each([1, 2, 0.5])('keeps the source end exclusive after a short tempo excursion at rate %s', (ratio) => {
        tempoMapStore.set({
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-up', beat: 0.0001, tempo: 240, curve: 'instant' },
                { id: 'tempo-back', beat: 0.0002, tempo: 120, curve: 'instant' },
            ],
        });
        const clip = { ...recording(0, 4), stretchMode: 'timestretch' as const, stretchRatio: ratio };
        const take = { ...placedPass('bounded', [0, 4], 0, 0.1), passSourceEndSeconds: 0.5 };
        const compStart = 0.5 / ratio;
        const state = lane([take], take.id, compStart, 4);
        takeLaneStore.set(state);
        const secondsAtBeat = (beat: number) => readSecondsAtBeat({ beat });
        const tempoAtBeat = (beat: number) => readTempoAtBeat({ beat });
        const live = resolveClipsWithComping('t1', [clip]);
        const offline = resolveTrackClipsWithComping('t1', [clip], state);
        const rendered = resolveTrackClipsWithComping(
            't1',
            [clip],
            state,
            renderTempoTimeline(secondsAtBeat, tempoAtBeat)
        );
        expect(offline).toEqual(live);
        for (const fragments of [live, offline, rendered]) {
            const selected = fragments.find((fragment) => fragment.regionStartBeat === compStart)!;
            expect(selected).toBeDefined();
            const [playback] = projectOfflineAudioClipPlaybacks({
                clip: selected,
                bufferDurationSeconds: 2,
                regionStartBeat: 0,
                regionStartSec: 0,
                durationSeconds: 2,
                compensationDelay: 0,
                projectBeatToSeconds: secondsAtBeat,
                resolveTempoAtBeat: tempoAtBeat,
            });
            expect(playback).toBeDefined();
            expect(playback!.playbackRate).toBe(ratio);
            const sourceEnd = playback!.bufferOffsetSec + playback!.playDuration * playback!.playbackRate;
            expect(sourceEnd).toBeCloseTo(0.5, 12);
            expect(Math.round(sourceEnd * 48000) - 1).toBe(23999);
        }
    });

    it.each([1, 2, 0.5])('preserves constant-tempo entry arithmetic on a sample grid at rate %s', (ratio) => {
        const tempo = 140;
        const start = 3.3;
        const compStart = start + 0.1 / ratio;
        const clip = { ...recording(start, 8), stretchMode: 'timestretch' as const, stretchRatio: ratio };
        const take = { ...placedPass('bounded', [start, 8], 0, 0.1), passSourceEndSeconds: 0.5 };
        const state = lane([take], take.id, compStart, 8);
        const sampleRate = 48000;
        const secondsAtBeat = (beat: number) => Math.round(((beat * 60) / tempo) * sampleRate) / sampleRate;
        const timeline = renderTempoTimeline(secondsAtBeat, () => tempo);
        const selected = resolveTrackClipsWithComping('t1', [clip], state, timeline).find(
            (fragment) => fragment.regionStartBeat === compStart
        )!;
        expect(selected).toBeDefined();
        expect(selected.audioOffsetBeats).toBe((0.1 * tempo) / 60 + (compStart - start) * ratio);
        const [playback] = projectOfflineAudioClipPlaybacks({
            clip: selected,
            bufferDurationSeconds: 2,
            regionStartBeat: start,
            regionStartSec: secondsAtBeat(start),
            durationSeconds: 2,
            compensationDelay: 0,
            projectBeatToSeconds: secondsAtBeat,
            resolveTempoAtBeat: () => tempo,
        });
        expect(playback).toBeDefined();
        expect(playback!.bufferOffsetSec).toBe(selected.audioOffsetBeats! * (60 / tempo));
        const sourceEnd = playback!.bufferOffsetSec + playback!.playDuration * playback!.playbackRate;
        expect(Math.abs(sourceEnd - take.passSourceEndSeconds)).toBeLessThanOrEqual(ratio / sampleRate);
    });

    const retainedFrameCases: readonly {
        name: string;
        clip: Clip;
        start: number;
        end: number;
        tempo: number;
    }[] = [
        { name: 'original', clip: recording(8, 16), start: 8, end: 8.8, tempo: 120 },
        { name: 'moved', clip: recording(12, 20), start: 12, end: 12.8, tempo: 120 },
        {
            name: 'faster source',
            clip: { ...recording(12, 20), stretchMode: 'timestretch', stretchRatio: 2 },
            start: 12,
            end: 12.4,
            tempo: 120,
        },
        {
            name: 'slower source',
            clip: { ...recording(12, 20), stretchMode: 'timestretch', stretchRatio: 0.5 },
            start: 12,
            end: 13.6,
            tempo: 120,
        },
        {
            name: 'faster slipped source',
            clip: { ...recording(12, 20, 0.2), stretchMode: 'timestretch', stretchRatio: 2 },
            start: 12,
            end: 12.3,
            tempo: 120,
        },
        {
            name: 'off with stored ratio',
            clip: { ...recording(12, 20), stretchMode: 'off', stretchRatio: 2 },
            start: 12,
            end: 12.8,
            tempo: 120,
        },
        { name: 'slipped', clip: recording(8, 16, 0.2), start: 8, end: 8.6, tempo: 120 },
        { name: 'trimmed', clip: recording(8.2, 16, 0.2), start: 8.2, end: 8.8, tempo: 120 },
        { name: 'tempo edited', clip: recording(8, 16), start: 8, end: 8.4, tempo: 60 },
    ];

    it.each(retainedFrameCases)('retains original captured frames when $name', ({ clip, start, end, tempo }) => {
        tempoMapStore.set({ changes: [{ id: 'tempo', beat: 0, tempo, curve: 'instant' }] });
        const take = { ...placedPass('bounded', [8, 8.8], 0, 0.1), passSourceEndSeconds: 0.5 };
        const state = lane([take], take.id, start, start + 2);
        takeLaneStore.set(state);
        expect(takeLaneStore.value).toEqual(state);
        const live = resolveClipsWithComping('t1', [clip]);
        const offline = resolveTrackClipsWithComping('t1', [clip], state);
        expect(offline).toEqual(live);
        const selected = live.find((fragment) => fragment.regionStartBeat === start)!;
        expect(selected.regionEndBeat).toBeCloseTo(end, 10);
        expect(live.some((fragment) => fragment.regionStartBeat >= end && fragment.regionStartBeat < start + 2)).toBe(
            false
        );
        const [playback] = projectOfflineAudioClipPlaybacks({
            clip: selected,
            bufferDurationSeconds: 2,
            regionStartBeat: start,
            regionStartSec: (start * 60) / tempo,
            durationSeconds: 8,
            compensationDelay: 0,
            projectBeatToSeconds: (beat) => (beat * 60) / tempo,
            resolveTempoAtBeat: () => tempo,
        });
        expect(playback).toBeDefined();
        const expectedSourceRate = clip.stretchMode === 'timestretch' ? clip.stretchRatio! : 1;
        expect(playback!.playbackRate).toBe(expectedSourceRate);
        const expectedEntry = 0.1 + ((clip.audioOffsetBeats ?? 0) * 60) / tempo;
        expect(playback!.bufferOffsetSec).toBeCloseTo(expectedEntry, 10);
        expect(playback!.bufferOffsetSec + playback!.playDuration * playback!.playbackRate).toBeCloseTo(0.5, 10);
        expect(
            Math.round((playback!.bufferOffsetSec + playback!.playDuration * playback!.playbackRate) * 48000) - 1
        ).toBe(23999);
        const trimSeconds = Math.min(0.1, playback!.playDuration / 2);
        const [trimmed] = projectOfflineAudioClipPlaybacks({
            clip: selected,
            bufferDurationSeconds: 2,
            regionStartBeat: start + (trimSeconds * tempo) / 60,
            regionStartSec: (start * 60) / tempo + trimSeconds,
            durationSeconds: 8,
            compensationDelay: 0,
            projectBeatToSeconds: (beat) => (beat * 60) / tempo,
            resolveTempoAtBeat: () => tempo,
        });
        expect(trimmed!.bufferOffsetSec).toBeCloseTo(expectedEntry + trimSeconds * expectedSourceRate, 10);
        expect(trimmed!.bufferOffsetSec + trimmed!.playDuration * trimmed!.playbackRate).toBeCloseTo(0.5, 10);
    });
});
