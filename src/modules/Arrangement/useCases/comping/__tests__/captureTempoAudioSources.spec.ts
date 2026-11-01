import { describe, expect, it } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type TakeLane } from '../../../models/TakeLane';
import { type TempoTimeline } from '../../../models/TempoTimeline';
import { type Clip } from '../../../models/Track';
import { captureTempoAudioSources } from '../captureTempoAudioSources';

const timeline: TempoTimeline = {
    secondsAtBeat: (beat) => beat / 2,
    beatAtSeconds: (seconds) => seconds * 2,
    tempoAtBeat: () => 120,
};

function source(overrides: Partial<Clip> = {}): Clip {
    return ClipDummy.create({
        id: 'source',
        trackId: 'audio',
        type: 'audio',
        startBeat: 0,
        endBeat: 12,
        audioBufferId: 'bursts',
        audioOffsetBeats: 8,
        ...overrides,
    });
}

function capture(clip = source(), lanes: TakeLane[] = [], clock = timeline) {
    return captureTempoAudioSources([TrackDummy.create({ id: 'audio', clips: [clip] })], lanes, clock);
}

describe('captureTempoAudioSources', () => {
    it('captures signed legacy clip entry and exact prior absence without touching its inputs', () => {
        const clip = source({ audioOffsetBeats: -2 });
        const before = structuredClone(clip);
        const plan = capture(clip);
        expect(plan?.clips).toMatchObject([
            {
                clipId: 'source',
                trackId: 'audio',
                before: {},
                after: { audioOffsetSeconds: -1, audioUnwrappedOffsetSeconds: -1 },
            },
        ]);
        expect(Object.keys(plan!.clips[0]!.before)).toEqual([]);
        expect(clip).toEqual(before);
    });

    it('captures deep legacy first entry, unwrapped media, reset, pass head and original grid independently', () => {
        const plan = capture(
            source({
                startBeat: 9,
                endBeat: 21,
                audioOffsetBeats: 19,
                loopEnabled: true,
                loopLength: 4,
                loopOriginBeat: 0,
                stretchMode: 'timestretch',
                stretchRatio: 2,
            })
        );
        expect(plan?.clips[0]?.after).toEqual({
            audioOffsetSeconds: 5.5,
            audioUnwrappedOffsetSeconds: 9.5,
            audioLoopStartSeconds: 5,
            audioLoopPassEntrySeconds: 5.5,
            audioLoopPassOriginBeat: 9,
        });
    });

    it('emits no write for a complete canonical zero tuple even with stale legacy beats', () => {
        const plan = capture(
            source({
                audioOffsetBeats: 99,
                audioOffsetSeconds: 0,
                audioUnwrappedOffsetSeconds: 4,
                audioLoopStartSeconds: -0.5,
                audioLoopPassEntrySeconds: 1,
                audioLoopPassOriginBeat: 0,
                loopEnabled: true,
                loopLength: 4,
            })
        );
        expect(plan).toEqual({ version: 1, clips: [], takes: [], regions: [], gaps: [], gapFieldPresence: [] });
    });

    it('captures unselected legacy depth and placed origin while retaining no-depth absence', () => {
        const lane: TakeLane = {
            id: 'lane',
            trackId: 'audio',
            activeCompRegions: [],
            takes: [
                { id: 'plain', clipId: 'source', name: 'Plain', startBeat: 17, endBeat: 40, selected: false },
                {
                    id: 'future',
                    clipId: 'source',
                    name: 'Future',
                    startBeat: 17,
                    endBeat: 40,
                    selected: false,
                    sourceOffsetBeats: 4,
                },
                {
                    id: 'placed',
                    clipId: 'source',
                    name: 'Placed',
                    startBeat: 17,
                    endBeat: 40,
                    selected: false,
                    sourceOffsetBeats: 4,
                    passAnchorSeconds: 10.5,
                    passDepthSeconds: 2,
                    passSourceEndSeconds: 6,
                },
            ],
        };
        const before = structuredClone(lane);
        const plan = capture(source({ startBeat: 17, endBeat: 40, audioOffsetBeats: 17 }), [lane]);
        expect(plan?.takes.map((take) => ({ id: take.takeId, before: take.before, after: take.after }))).toEqual([
            { id: 'future', before: {}, after: { sourceOffsetSeconds: 2 } },
            {
                id: 'placed',
                before: {},
                after: {
                    sourceOffsetSeconds: 2,
                    passOriginBeat: 17,
                    passOriginSourceSeconds: 8.5,
                },
            },
        ]);
        expect(lane).toEqual(before);
    });

    it('captures the actual selected programme and both independent legacy gap fragments', () => {
        const lane: TakeLane = {
            id: 'lane',
            trackId: 'audio',
            takes: [
                {
                    id: 'selected',
                    clipId: 'source',
                    name: 'Selected',
                    startBeat: 0,
                    endBeat: 12,
                    selected: true,
                    sourceOffsetBeats: 4,
                },
            ],
            activeCompRegions: [{ startBeat: 1, endBeat: 11, takeId: 'selected' }],
        };
        const plan = capture(
            source({ loopEnabled: true, loopLength: 4, stretchMode: 'timestretch', stretchRatio: 2 }),
            [lane]
        );
        expect(plan?.regions[0]).toMatchObject({
            startBeat: 1,
            endBeat: 11,
            before: { present: false },
            after: {
                present: true,
                value: {
                    startBeat: 1,
                    audioOffsetSeconds: 6.5,
                    audioLoopStartSeconds: 6.5,
                    audioLoopPassEntrySeconds: 6.5,
                    audioLoopPassOriginBeat: 1,
                    loopOriginBeat: 1,
                    loopLength: 4,
                },
            },
        });
        expect(plan?.gaps.map((gap) => ({ start: gap.startBeat, end: gap.endBeat, after: gap.after }))).toEqual([
            {
                start: 0,
                end: 1,
                after: {
                    present: true,
                    value: {
                        startBeat: 0,
                        audioOffsetSeconds: 4,
                        audioLoopStartSeconds: 4,
                        audioLoopPassEntrySeconds: 4,
                        audioLoopPassOriginBeat: 0,
                        loopOriginBeat: 0,
                        loopLength: 4,
                    },
                },
            },
            {
                start: 11,
                end: 12,
                after: {
                    present: true,
                    value: {
                        startBeat: 11,
                        audioOffsetSeconds: 9.5,
                        audioLoopStartSeconds: 9.5,
                        audioLoopPassEntrySeconds: 9.5,
                        audioLoopPassOriginBeat: 11,
                        loopOriginBeat: 11,
                        loopLength: 4,
                    },
                },
            },
        ]);
        expect(plan?.gapFieldPresence).toEqual([{ laneId: 'lane', trackId: 'audio', before: false, after: true }]);
    });

    it('uses the supplied old integrated map at an interior region head', () => {
        const oldMap: TempoTimeline = {
            secondsAtBeat: (beat) => (beat <= 2 ? beat / 2 : 1 + (beat - 2) / 4),
            beatAtSeconds: (seconds) => (seconds <= 1 ? seconds * 2 : 2 + (seconds - 1) * 4),
            tempoAtBeat: (beat) => (beat < 2 ? 120 : 240),
        };
        const lane: TakeLane = {
            id: 'lane',
            trackId: 'audio',
            takes: [
                {
                    id: 'selected',
                    clipId: 'source',
                    name: 'Selected',
                    startBeat: 0,
                    endBeat: 12,
                    selected: true,
                    sourceOffsetBeats: 4,
                },
            ],
            activeCompRegions: [{ startBeat: 3, endBeat: 10, takeId: 'selected' }],
        };
        const plan = capture(source(), [lane], oldMap);
        expect(plan?.regions[0]?.after).toMatchObject({ present: true, value: { audioOffsetSeconds: 7.25 } });
    });

    it('binds inactive live clips to their alternative and skips the stale active stored copy', () => {
        const track = TrackDummy.create({
            id: 'audio',
            activeAlternativeId: 'main',
            clips: [source()],
            alternatives: [
                { id: 'main', name: 'Main', clips: [source({ id: 'stale', audioOffsetBeats: 99 })] },
                { id: 'other', name: 'Other', clips: [source({ id: 'other-source', audioOffsetBeats: 12 })] },
            ],
        });
        const plan = captureTempoAudioSources([track], [], timeline);
        expect(
            plan?.clips.map((clip) => ({
                trackId: clip.trackId,
                collection: clip.collection,
                alternativeId: clip.alternativeId,
                clipId: clip.clipId,
                source: clip.after.audioOffsetSeconds,
            }))
        ).toEqual([
            { trackId: 'audio', collection: 'active', alternativeId: 'main', clipId: 'source', source: 4 },
            { trackId: 'audio', collection: 'alternative', alternativeId: 'other', clipId: 'other-source', source: 6 },
        ]);
    });

    it('captures retained takes that will become audible when their inactive source alternative is activated', () => {
        const track = TrackDummy.create({
            id: 'audio',
            activeAlternativeId: 'main',
            clips: [],
            alternatives: [
                { id: 'main', name: 'Main', clips: [] },
                { id: 'other', name: 'Other', clips: [source({ audioOffsetBeats: 17, startBeat: 17, endBeat: 40 })] },
            ],
        });
        const lane: TakeLane = {
            id: 'lane',
            trackId: 'audio',
            activeCompRegions: [],
            takes: [
                {
                    id: 'placed',
                    clipId: 'source',
                    name: 'Placed',
                    selected: false,
                    startBeat: 17,
                    endBeat: 40,
                    sourceOffsetBeats: 4,
                    passAnchorSeconds: 10.5,
                    passDepthSeconds: 2,
                    passSourceEndSeconds: 6,
                },
            ],
        };
        const plan = captureTempoAudioSources([track], [lane], timeline);
        expect(plan?.clips[0]).toMatchObject({ collection: 'alternative', alternativeId: 'other', clipId: 'source' });
        expect(plan?.takes[0]?.after).toEqual({
            sourceOffsetSeconds: 2,
            passOriginBeat: 17,
            passOriginSourceSeconds: 8.5,
        });
    });

    it('refuses ambiguous retained take ownership across independent live clip locations', () => {
        const track = TrackDummy.create({
            id: 'audio',
            activeAlternativeId: 'main',
            clips: [source()],
            alternatives: [
                { id: 'main', name: 'Main', clips: [] },
                { id: 'other', name: 'Other', clips: [source({ audioOffsetBeats: 12 })] },
            ],
        });
        const lane: TakeLane = {
            id: 'lane',
            trackId: 'audio',
            activeCompRegions: [],
            takes: [
                {
                    id: 'future',
                    clipId: 'source',
                    name: 'Ambiguous',
                    selected: false,
                    startBeat: 0,
                    endBeat: 12,
                    sourceOffsetBeats: 4,
                },
            ],
        };
        expect(captureTempoAudioSources([track], [lane], timeline)).toBeNull();
    });
});
