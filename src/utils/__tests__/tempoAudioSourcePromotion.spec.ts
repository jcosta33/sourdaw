import { from } from '@automerge/automerge';
import { describe, expect, it } from 'vitest';

import { type TempoAudioSourcePromotionSnapshot } from '../handlerContract';
import { captureTempoSourceOwnerValue, isTempoAudioSourcePromotion } from '../tempoAudioSourcePromotion';

function plan(): TempoAudioSourcePromotionSnapshot {
    return {
        version: 1,
        clips: [
            {
                trackId: 'audio',
                collection: 'active',
                alternativeId: 'main',
                clipId: 'source',
                inputs: {
                    startBeat: 0,
                    endBeat: 12,
                    audioOffsetBeats: 8,
                    audioBufferId: 'bursts',
                    loopEnabled: true,
                    loopLength: 4,
                },
                before: {},
                after: {
                    audioOffsetSeconds: 4,
                    audioUnwrappedOffsetSeconds: 4,
                    audioLoopStartSeconds: 4,
                    audioLoopPassEntrySeconds: 4,
                    audioLoopPassOriginBeat: 0,
                },
            },
        ],
        takes: [
            {
                trackId: 'audio',
                laneId: 'lane',
                takeId: 'selected',
                clipId: 'source',
                inputs: { startBeat: 0, endBeat: 12, sourceOffsetBeats: 4 },
                before: {},
                after: { sourceOffsetSeconds: 2 },
            },
        ],
        regions: [
            {
                trackId: 'audio',
                laneId: 'lane',
                takeId: 'selected',
                clipId: 'source',
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
            },
        ],
        gaps: [
            {
                trackId: 'audio',
                laneId: 'lane',
                clipId: 'source',
                startBeat: 0,
                endBeat: 1,
                before: { present: false },
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
        ],
        gapFieldPresence: [{ trackId: 'audio', laneId: 'lane', before: false, after: true }],
    };
}

describe('tempo source-promotion value decoder', () => {
    it('captures selected raw source fields with the former JSON number representation', () => {
        const owner = {
            kind: 'clip' as const,
            trackId: 'audio',
            collection: 'active' as const,
            alternativeId: 'main',
            clipId: 'source',
        };
        const audioSource = {
            startBeat: -0,
            audioOffsetSeconds: -0,
            audioLoopStartSeconds: -0,
            audioLoopPassEntrySeconds: -0,
            audioLoopPassOriginBeat: -0,
            loopOriginBeat: -0,
            loopLength: 4,
        };
        const clip = { id: 'source', startBeat: -0, audioOffsetSeconds: -0, audioSource, name: 'cosmetic' };
        const context = { tracks: { tracks: [{ id: 'audio', activeAlternativeId: 'main', clips: [clip] }] } };
        const fields = ['id', 'startBeat', 'audioOffsetSeconds', 'audioSource', 'fileId'];
        const expected = {
            present: true,
            value: {
                id: clip.id,
                startBeat: 0,
                audioOffsetSeconds: 0,
                audioSource: {
                    startBeat: 0,
                    audioOffsetSeconds: 0,
                    audioLoopStartSeconds: 0,
                    audioLoopPassEntrySeconds: 0,
                    audioLoopPassOriginBeat: 0,
                    loopOriginBeat: 0,
                    loopLength: 4,
                },
            },
        };
        expect(captureTempoSourceOwnerValue(context, owner, fields)).toStrictEqual(expected);
        expect(captureTempoSourceOwnerValue(from(context), owner, fields)).toStrictEqual(expected);
        expect(Object.hasOwn(expected.value, 'fileId')).toBe(false);
    });

    it('keeps the former selected nonfinite number capture as null', () => {
        const owner = {
            kind: 'clip' as const,
            trackId: 'audio',
            collection: 'active' as const,
            alternativeId: 'main',
            clipId: 'source',
        };
        const context = {
            tracks: {
                tracks: [
                    { id: 'audio', activeAlternativeId: 'main', clips: [{ id: 'source', startBeat: Number.NaN }] },
                ],
            },
        };
        expect(captureTempoSourceOwnerValue(context, owner, ['startBeat'])).toStrictEqual({
            present: true,
            value: { startBeat: null },
        });
    });

    it('decodes a complete bounded source programme without consulting live project state', () => {
        const wire = JSON.stringify(plan());
        expect(wire).toContain('"audioOffsetSeconds":4');
        expect(wire).toContain('"audioLoopPassOriginBeat":0');
        expect(wire).toContain('"before":{}');
        expect(isTempoAudioSourcePromotion(JSON.parse(wire))).toBe(true);
    });

    it('keeps canonical zero and fresh defaults independent of stale legacy beats', () => {
        const original = plan();
        const clip = original.clips[0]!;
        const value = {
            ...original,
            takes: [],
            regions: [],
            gaps: [],
            gapFieldPresence: [],
            clips: [
                {
                    ...clip,
                    inputs: { ...clip.inputs, audioOffsetBeats: 99 },
                    before: { audioOffsetSeconds: 0 },
                    after: {
                        audioOffsetSeconds: 0,
                        audioUnwrappedOffsetSeconds: 0,
                        audioLoopStartSeconds: 0,
                        audioLoopPassEntrySeconds: 0,
                        audioLoopPassOriginBeat: 0,
                    },
                },
            ],
        };
        expect(isTempoAudioSourcePromotion(value)).toBe(true);
        expect(
            isTempoAudioSourcePromotion({
                ...value,
                clips: [
                    {
                        ...value.clips[0],
                        after: {
                            ...value.clips[0]!.after,
                            audioOffsetSeconds: 49.5,
                        },
                    },
                ],
            })
        ).toBe(false);
    });

    it.each([
        { audioUnwrappedOffsetSeconds: 0 },
        { audioLoopStartSeconds: 0 },
        { audioOffsetSeconds: Number.NaN },
        { audioOffsetSeconds: undefined },
    ])('rejects orphan or malformed prior source fields %j', (before) => {
        const value = plan();
        expect(isTempoAudioSourcePromotion({ ...value, clips: [{ ...value.clips[0], before }] })).toBe(false);
    });

    it('rejects an incomplete newly written loop tuple', () => {
        const value = plan();
        const after = structuredClone(value.clips[0]!.after);
        delete after.audioLoopPassOriginBeat;
        expect(isTempoAudioSourcePromotion({ ...value, clips: [{ ...value.clips[0], after }] })).toBe(false);
    });

    it('rejects unknown fields rather than treating copied private authorization as input', () => {
        expect(isTempoAudioSourcePromotion({ ...plan(), authorization: true })).toBe(false);
    });

    it('rejects an active stored-copy alias and duplicate located source owner', () => {
        const value = plan();
        expect(isTempoAudioSourcePromotion({ ...value, clips: [...value.clips, value.clips[0]] })).toBe(false);
        expect(
            isTempoAudioSourcePromotion({
                ...value,
                clips: [
                    ...value.clips,
                    {
                        ...value.clips[0],
                        collection: 'alternative',
                        clipId: 'stale-copy',
                    },
                ],
            })
        ).toBe(false);
    });

    it('rejects cross-owner and out-of-source-range support metadata', () => {
        const value = plan();
        expect(
            isTempoAudioSourcePromotion({ ...value, regions: [{ ...value.regions[0], trackId: 'peer-track' }] })
        ).toBe(false);
        expect(isTempoAudioSourcePromotion({ ...value, gaps: [{ ...value.gaps[0], endBeat: 13 }] })).toBe(false);
        expect(isTempoAudioSourcePromotion({ ...value, gapFieldPresence: [] })).toBe(false);
    });

    it('rejects a split placed origin pair and admits the original finite signed source basis', () => {
        const value = plan();
        const take = value.takes[0]!;
        const inputs = { ...take.inputs, passAnchorSeconds: 6, passDepthSeconds: 2, passSourceEndSeconds: 6 };
        const placed = {
            ...value,
            regions: [],
            takes: [
                { ...take, inputs, after: { sourceOffsetSeconds: 2, passOriginBeat: 0, passOriginSourceSeconds: 4 } },
            ],
        };
        expect(isTempoAudioSourcePromotion(placed)).toBe(true);
        expect(
            isTempoAudioSourcePromotion({
                ...placed,
                takes: [{ ...placed.takes[0], after: { sourceOffsetSeconds: 2, passOriginBeat: 0 } }],
            })
        ).toBe(false);
        expect(
            isTempoAudioSourcePromotion({
                ...placed,
                takes: [
                    {
                        ...placed.takes[0],
                        after: { sourceOffsetSeconds: 2, passOriginBeat: 0, passOriginSourceSeconds: -4 },
                    },
                ],
            })
        ).toBe(false);
    });
});
