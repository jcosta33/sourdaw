import { describe, expect, it } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { type TakeLane } from '../../../models/TakeLane';
import { resolveCompingProgramme } from '../../comping/resolveCompingProgramme';
import { audioClipSlipOffsetBeats } from '../audioClipSlipOffsetBeats';
import { prepareAudioClipSlip } from '../prepareAudioClipSlip';

const timeline = {
    secondsAtBeat: (beat: number) => beat / 2,
    beatAtSeconds: (seconds: number) => seconds * 2,
    tempoAtBeat: () => 120,
};
const clip = (fields = {}) =>
    ClipDummy.create({
        id: 'c',
        trackId: 't',
        type: 'audio',
        startBeat: 0,
        endBeat: 8,
        audioOffsetBeats: 0.5,
        audioOffsetSeconds: 0.25,
        audioUnwrappedOffsetSeconds: 0.25,
        ...fields,
    });

describe('canonical audio slip source translation', () => {
    it('sets absolute media beats, translating source entry without moving the rectangle', () => {
        const before = clip();
        const after = prepareAudioClipSlip({ clip: before, lanes: [] }, 0.7, timeline);
        expect(after?.clip).toEqual({
            ...before,
            audioOffsetBeats: 0.7,
            audioOffsetSeconds: 0.35,
            audioUnwrappedOffsetSeconds: 0.35,
        });
    });

    it('starts from authoritative U after tempo promotion, including zero and signed pre-roll', () => {
        const slow = {
            ...timeline,
            tempoAtBeat: () => 60,
            secondsAtBeat: (beat: number) => beat,
            beatAtSeconds: (seconds: number) => seconds,
        };
        const before = clip({ audioOffsetBeats: 99, audioOffsetSeconds: 0, audioUnwrappedOffsetSeconds: -0.25 });
        expect(audioClipSlipOffsetBeats(before, slow)).toBe(-0.25);
        const noMotion = prepareAudioClipSlip({ clip: before, lanes: [] }, -0.25, slow);
        expect(noMotion?.clip.audioOffsetSeconds).toBe(0);
        expect(noMotion?.clip.audioUnwrappedOffsetSeconds).toBe(-0.25);
        const moved = prepareAudioClipSlip({ clip: before, lanes: [] }, -0.15, slow);
        expect(moved?.clip.audioOffsetSeconds).toBeCloseTo(0.1);
        expect(moved?.clip.audioUnwrappedOffsetSeconds).toBeCloseTo(-0.15);
    });

    it.each(['off', 'repitch', 'timestretch'] as const)(
        'keeps first head, repeat reset and song anchors independent in %s',
        (stretchMode) => {
            const before = clip({
                loopEnabled: true,
                loopLength: 2,
                loopOriginBeat: -2,
                audioOffsetSeconds: 0.2,
                audioUnwrappedOffsetSeconds: 5,
                audioLoopStartSeconds: 0.1,
                audioLoopPassEntrySeconds: 0.3,
                audioLoopPassOriginBeat: -1,
                stretchMode,
                stretchRatio: 99,
            });
            const after = prepareAudioClipSlip({ clip: before, lanes: [] }, 10.2, timeline)?.clip;
            expect(after).toMatchObject({
                audioOffsetSeconds: expect.closeTo(0.3),
                audioUnwrappedOffsetSeconds: expect.closeTo(5.1),
                audioLoopStartSeconds: expect.closeTo(0.2),
                audioLoopPassEntrySeconds: expect.closeTo(0.4),
                audioLoopPassOriginBeat: -1,
                loopOriginBeat: -2,
                startBeat: 0,
                endBeat: 8,
                stretchRatio: 99,
            });
        }
    );

    it('translates selected snapshots and gap owners while retaining peer owners and original takes', () => {
        const source = {
            startBeat: 0,
            audioOffsetSeconds: 1,
            audioLoopStartSeconds: 0.2,
            audioLoopPassEntrySeconds: 0.4,
            audioLoopPassOriginBeat: 0,
            loopOriginBeat: 0,
            loopLength: 2,
        };
        const take = { id: 'take', clipId: 'c', name: 'Manual', startBeat: 0, endBeat: 8, selected: true };
        const peer = { ...take, id: 'peer', clipId: 'other' };
        const lane: TakeLane = {
            id: 'lane',
            trackId: 't',
            takes: [take, peer],
            activeCompRegions: [
                { takeId: 'take', startBeat: 1, endBeat: 3, audioSource: source },
                { takeId: 'peer', startBeat: 4, endBeat: 5, audioSource: source },
            ],
            baseGapAudioSources: [
                { clipId: 'c', startBeat: 0, endBeat: 1, audioSource: source },
                { clipId: 'other', startBeat: 0, endBeat: 1, audioSource: source },
            ],
        };
        const before = { clip: clip(), lanes: [lane] };
        const after = prepareAudioClipSlip(before, 0.7, timeline);
        expect(after).not.toBeNull();
        const oldProgramme = resolveCompingProgramme('t', [before.clip], { lanes: before.lanes }, timeline);
        const newProgramme = resolveCompingProgramme('t', [after!.clip], { lanes: after!.lanes }, timeline);
        expect(newProgramme.map((part) => part.audioOffsetSeconds)).toEqual(
            oldProgramme.map((part) => expect.closeTo(part.audioOffsetSeconds! + 0.1))
        );
        expect(after!.lanes[0]!.takes).toEqual(lane.takes);
        expect(after!.lanes[0]!.activeCompRegions[1]).toEqual(lane.activeCompRegions[1]);
        expect(after!.lanes[0]!.baseGapAudioSources?.find((tile) => tile.clipId === 'other')).toEqual(
            lane.baseGapAudioSources![1]
        );
    });

    it.each([1, 2])('moves the placed pass by its owned origin at source rate %s', (rate) => {
        const take = {
            id: 'placed',
            clipId: 'c',
            name: 'Pass',
            startBeat: 0,
            endBeat: 8,
            selected: true,
            sourceOffsetBeats: 4,
            passAnchorSeconds: 1,
            passDepthSeconds: 2,
            passSourceEndSeconds: 4,
            passOriginBeat: 0,
            passOriginSourceSeconds: 0.25,
        };
        const lane: TakeLane = {
            id: 'lane',
            trackId: 't',
            takes: [take],
            activeCompRegions: [{ takeId: 'placed', startBeat: 0, endBeat: 8 }],
        };
        const before = { clip: clip({ stretchMode: 'timestretch', stretchRatio: rate }), lanes: [lane] };
        const after = prepareAudioClipSlip(before, 0.7, timeline)!;
        expect(after.lanes[0]!.takes[0]).toEqual({ ...take, passOriginSourceSeconds: 0.35 });
        const oldProgramme = resolveCompingProgramme('t', [before.clip], { lanes: before.lanes }, timeline);
        const newProgramme = resolveCompingProgramme('t', [after.clip], { lanes: after.lanes }, timeline);
        expect(newProgramme[0]!.startBeat).toBeCloseTo(oldProgramme[0]!.startBeat - 0.2 / rate);
        expect(newProgramme[0]!.audioOffsetSeconds).toBeCloseTo(2);
    });

    it('captures the actual legacy placed basis and refuses partial/present-undefined origins', () => {
        const take = {
            id: 'placed',
            clipId: 'c',
            name: 'Pass',
            startBeat: 0,
            endBeat: 8,
            selected: true,
            sourceOffsetBeats: 4,
            passAnchorSeconds: 1,
            passDepthSeconds: 2,
        };
        const lane = { id: 'lane', trackId: 't', takes: [take], activeCompRegions: [] };
        const before = { clip: clip({ audioOffsetBeats: 1, audioUnwrappedOffsetSeconds: 0.25 }), lanes: [lane] };
        expect(prepareAudioClipSlip(before, 0.7, timeline)?.lanes[0]!.takes[0]).toEqual({
            ...take,
            passOriginBeat: 0,
            passOriginSourceSeconds: 0.6,
        });
        for (const fields of [
            { passOriginBeat: 0 },
            { passOriginBeat: undefined, passOriginSourceSeconds: undefined },
        ]) {
            expect(
                prepareAudioClipSlip(
                    { ...before, lanes: [{ ...lane, takes: [{ ...take, ...fields }] }] },
                    0.7,
                    timeline
                )
            ).toBeNull();
        }
    });
});
