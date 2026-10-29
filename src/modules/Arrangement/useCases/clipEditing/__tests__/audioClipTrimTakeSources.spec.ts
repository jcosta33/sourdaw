import { describe, expect, it } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { createTake, createTakeLane } from '../../../models/TakeLane';
import { type TempoTimeline } from '../../../models/TempoTimeline';
import { captureTakeSource } from '../../comping/captureTakeSource';
import {
    audioClipTrimTakeSourcesMatch,
    captureAudioClipTrimTakeSources,
    isAudioClipTrimTakeSources,
    projectAudioClipTrimTakeSources,
} from '../audioClipTrimTakeSources';

const timeline: TempoTimeline = {
    tempoAtBeat: () => 120,
    secondsAtBeat: (beat) => beat / 2,
    beatAtSeconds: (seconds) => seconds * 2,
};
const clip = ClipDummy.create({ id: 'clip', trackId: 'track', type: 'audio', startBeat: 8, endBeat: 16 });

function fixture() {
    const unplaced = { ...createTake(clip.id, 'Legacy', 6, 20, 8), id: 'unplaced' };
    const placed = {
        ...createTake(clip.id, 'Placed', 7, 18, 0),
        id: 'placed',
        passAnchorSeconds: 0,
        passDepthSeconds: 1,
        passSourceEndSeconds: 5,
    };
    const peer = { ...createTake('peer-clip', 'Peer', 2, 4), id: 'peer' };
    const lane = {
        ...createTakeLane('track'),
        takes: [unplaced, peer, placed],
        activeCompRegions: [{ startBeat: 8, endBeat: 16, takeId: placed.id }],
    };
    return { lane, unplaced, placed, peer };
}

describe('audio head trim captures only the original take source basis', () => {
    it('uses the unchanged capture law and retains overhang, comp rows, order and peer facets through both directions', () => {
        const { lane, unplaced, placed } = fixture();
        const transitions = captureAudioClipTrimTakeSources(clip, [lane], timeline);
        expect(isAudioClipTrimTakeSources(transitions, clip, timeline)).toBe(true);
        expect(transitions[0]?.takesAfter).toEqual([
            captureTakeSource(unplaced, clip, timeline),
            captureTakeSource(placed, clip, timeline),
        ]);
        const live = {
            ...lane,
            takes: lane.takes.toReversed().map((take) => ({ ...take, name: 'Peer name', selected: true })),
        };
        const projected = projectAudioClipTrimTakeSources([live], clip.id, transitions, 'apply');
        expect(projected?.[0]).toEqual({
            ...live,
            takes: live.takes.map((take) =>
                captureTakeSource(take, take.clipId === clip.id ? clip : undefined, timeline)
            ),
        });
        expect(projected?.[0]?.takes.map((take) => [take.id, take.startBeat, take.endBeat])).toEqual(
            live.takes.map((take) => [take.id, take.startBeat, take.endBeat])
        );
        expect(projectAudioClipTrimTakeSources(projected!, clip.id, transitions, 'restore')).toEqual([live]);
        expect(
            Object.hasOwn(
                projectAudioClipTrimTakeSources(projected!, clip.id, transitions, 'restore')![0]!.takes[2]!,
                'sourceOffsetSeconds'
            )
        ).toBe(false);
    });

    it('captures the original region programme before take promotion and keeps existing source snapshots verbatim', () => {
        const { lane, unplaced } = fixture();
        const original = { ...lane, activeCompRegions: [{ startBeat: 8, endBeat: 16, takeId: unplaced.id }] };
        const sourceClip = {
            ...clip,
            loopEnabled: true,
            loopLength: 4,
            stretchMode: 'timestretch' as const,
            stretchRatio: 2,
        };
        const transitions = captureAudioClipTrimTakeSources(sourceClip, [original], timeline);
        const snapshot = transitions[0]!.regionsAfter[0]!.audioSource;
        expect(snapshot).toMatchObject({
            startBeat: 8,
            audioOffsetSeconds: 4,
            audioLoopStartSeconds: 4,
            audioLoopPassEntrySeconds: 4,
            audioLoopPassOriginBeat: 8,
            loopLength: 4,
        });
        expect(isAudioClipTrimTakeSources(transitions, sourceClip, timeline)).toBe(true);
        const projected = projectAudioClipTrimTakeSources([original], clip.id, transitions, 'apply');
        expect(projected?.[0]?.activeCompRegions).toEqual([
            { ...original.activeCompRegions[0], audioSource: snapshot },
        ]);
        expect(projectAudioClipTrimTakeSources(projected!, clip.id, transitions, 'restore')).toEqual([original]);
        const alreadyCaptured = captureAudioClipTrimTakeSources(sourceClip, projected!, timeline);
        expect(alreadyCaptured[0]?.regionsAfter).toEqual(alreadyCaptured[0]?.regionsBefore);
        const forged = structuredClone(transitions);
        forged[0]!.regionsAfter[0]!.audioSource = {
            ...forged[0]!.regionsAfter[0]!.audioSource!,
            audioOffsetSeconds: 9,
        };
        expect(isAudioClipTrimTakeSources(forged, sourceClip, timeline)).toBe(false);
    });

    it('refuses every forged derivation input even when both captured copies describe a lawful different source', () => {
        const { lane } = fixture();
        const transitions = captureAudioClipTrimTakeSources(clip, [lane], timeline);
        const forged = structuredClone(transitions);
        forged[0]!.takesBefore[0]!.sourceOffsetBeats = 12;
        forged[0]!.takesAfter[0]!.sourceOffsetBeats = 12;
        forged[0]!.takesAfter[0]!.sourceOffsetSeconds = 6;
        expect(isAudioClipTrimTakeSources(forged, clip, timeline)).toBe(true);
        expect(audioClipTrimTakeSourcesMatch([lane], clip.id, forged, 'apply')).toBe(false);
        expect(projectAudioClipTrimTakeSources([lane], clip.id, forged, 'apply')).toBeNull();
        for (const field of [
            'passAnchorSeconds',
            'passDepthSeconds',
            'passSourceEndSeconds',
            'sourceOffsetBeats',
            'passOriginBeat',
            'passOriginSourceSeconds',
        ] as const) {
            const altered = structuredClone(lane);
            altered.takes[2]![field] = 99;
            expect(audioClipTrimTakeSourcesMatch([altered], clip.id, transitions, 'apply'), field).toBe(false);
        }
    });

    it('requires complete unique membership and refuses non-source transitions', () => {
        const { lane } = fixture();
        const transitions = captureAudioClipTrimTakeSources(clip, [lane], timeline);
        for (const takes of [
            lane.takes.slice(1),
            [...lane.takes, { ...lane.takes[0]!, id: 'late' }],
            [...lane.takes, lane.takes[0]!],
        ]) {
            expect(projectAudioClipTrimTakeSources([{ ...lane, takes }], clip.id, transitions, 'apply')).toBeNull();
        }
        const altered = structuredClone(transitions);
        altered[0]!.takesAfter[0]!.startBeat = 8;
        expect(isAudioClipTrimTakeSources(altered, clip, timeline)).toBe(false);
        expect(isAudioClipTrimTakeSources(undefined, clip, timeline)).toBe(false);
    });
});
