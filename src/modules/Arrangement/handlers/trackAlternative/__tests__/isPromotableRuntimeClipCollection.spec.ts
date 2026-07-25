import { describe, it, expect } from 'vitest';

import { isPromotableRuntimeClipCollection } from '../isPromotableRuntimeClipCollection';

function validClip(id: string, trackId = 't1') {
    return {
        id,
        trackId,
        name: id,
        color: '#fff',
        type: 'midi' as const,
        locked: false,
        muted: false,
        startBeat: 0,
        endBeat: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
    };
}

function minimalTracks() {
    return [{ id: 't1', clips: [], alternatives: [] }];
}

const SOURCE = { kind: 'alternative' as const, trackId: 't1', alternativeId: 'alt-1' };

describe('isPromotableRuntimeClipCollection — accept path', () => {
    it('accepts an array of valid clips with no external collisions', () => {
        const result = isPromotableRuntimeClipCollection({
            value: [validClip('c1'), validClip('c2')],
            targetTrackId: 't1',
            tracks: minimalTracks(),
            source: SOURCE,
        });
        expect(result).toBe(true);
    });

    it('accepts an empty array', () => {
        expect(
            isPromotableRuntimeClipCollection({
                value: [],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(true);
    });
});

describe('isPromotableRuntimeClipCollection — value shape rejections', () => {
    it('rejects a non-array value', () => {
        expect(
            isPromotableRuntimeClipCollection({
                value: { id: 'c1' },
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects a clip with an empty id', () => {
        const clip = validClip('');
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects a clip whose trackId does not match the target', () => {
        const clip = validClip('c1', 'other-track');
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects a clip with an invalid type', () => {
        const clip = { ...validClip('c1'), type: 'garbage' };
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects a clip with endBeat <= startBeat', () => {
        const clip = { ...validClip('c1'), startBeat: 4, endBeat: 4 };
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects a clip with negative fadeInBeats', () => {
        const clip = { ...validClip('c1'), fadeInBeats: -1 };
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects a clip with a non-finite gain', () => {
        const clip = { ...validClip('c1'), gain: Number.NaN };
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects a clip with an unknown stretchMode', () => {
        const clip = { ...validClip('c1'), stretchMode: 'vaporize' };
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects a clip with an unknown followAction', () => {
        const clip = { ...validClip('c1'), followAction: 'explode' };
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects duplicate clip ids within the collection', () => {
        expect(
            isPromotableRuntimeClipCollection({
                value: [validClip('c1'), validClip('c1')],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });
});

describe('isPromotableRuntimeClipCollection — external collision detection', () => {
    it('rejects when an external track active clip shares an id', () => {
        const tracks = [
            { id: 't1', clips: [], alternatives: [] },
            { id: 't2', clips: [validClip('c1', 't2')], alternatives: [] },
        ];
        expect(
            isPromotableRuntimeClipCollection({
                value: [validClip('c1')],
                targetTrackId: 't1',
                tracks,
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects when an external alternative clip shares an id', () => {
        const tracks = [
            { id: 't1', clips: [], alternatives: [] },
            {
                id: 't2',
                clips: [],
                alternatives: [{ id: 'alt-x', clips: [validClip('c1', 't2')] }],
            },
        ];
        expect(
            isPromotableRuntimeClipCollection({
                value: [validClip('c1')],
                targetTrackId: 't1',
                tracks,
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('allows collisions within the source alternative itself', () => {
        // The source alternative's own clips are skipped during collision check.
        const tracks = [
            {
                id: 't1',
                clips: [],
                alternatives: [{ id: 'alt-1', clips: [validClip('c1')] }],
            },
        ];
        expect(
            isPromotableRuntimeClipCollection({
                value: [validClip('c1')],
                targetTrackId: 't1',
                tracks,
                source: SOURCE,
            })
        ).toBe(true);
    });

    it('skips the active snapshot for an active-kind source', () => {
        const activeSource = { kind: 'active' as const, trackId: 't1', activeAlternativeId: 'alt-1' };
        const tracks = [
            {
                id: 't1',
                clips: [],
                alternatives: [{ id: 'alt-1', clips: [validClip('c1')] }],
            },
        ];
        expect(
            isPromotableRuntimeClipCollection({
                value: [validClip('c1')],
                targetTrackId: 't1',
                tracks,
                source: activeSource,
            })
        ).toBe(true);
    });

    it('rejects malformed tracks (non-array alternatives)', () => {
        expect(
            isPromotableRuntimeClipCollection({
                value: [validClip('c1')],
                targetTrackId: 't1',
                tracks: [{ id: 't1', clips: [], alternatives: 'garbage' }],
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects when tracks is not an array', () => {
        expect(
            isPromotableRuntimeClipCollection({
                value: [validClip('c1')],
                targetTrackId: 't1',
                tracks: 'garbage',
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects when an external track clip element is malformed (treats as collision)', () => {
        const tracks = [
            { id: 't1', clips: [], alternatives: [] },
            { id: 't2', clips: ['garbage'], alternatives: [] },
        ];
        expect(
            isPromotableRuntimeClipCollection({
                value: [validClip('c1')],
                targetTrackId: 't1',
                tracks,
                source: SOURCE,
            })
        ).toBe(false);
    });
});

describe('isPromotableRuntimeClipCollection — optional field type validation', () => {
    it('rejects a non-finite optional number field (stretchRatio)', () => {
        const clip = { ...validClip('c1'), stretchRatio: Infinity };
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects a non-string optional string field (audioBufferId)', () => {
        const clip = { ...validClip('c1'), audioBufferId: 123 };
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects a non-boolean optional boolean field (loopEnabled)', () => {
        const clip = { ...validClip('c1'), loopEnabled: 'yes' };
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('accepts a clip with valid optional fields', () => {
        const clip = {
            ...validClip('c1'),
            stretchRatio: 1.5,
            audioBufferId: 'buf-1',
            loopEnabled: true,
            stretchMode: 'repitch',
            followAction: 'play_next',
        };
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(true);
    });
});

describe('isPromotableRuntimeClipCollection — overrides validation', () => {
    it('accepts a clip with a boolean overrides record', () => {
        const clip = { ...validClip('c1'), overrides: { gain: true, color: false } };
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(true);
    });

    it('rejects a clip with a non-boolean value in overrides', () => {
        const clip = { ...validClip('c1'), overrides: { gain: 'yes' } };
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });
});

describe('isPromotableRuntimeClipCollection — kneadState validation', () => {
    function clipWithKnead(kneadState: unknown) {
        return { ...validClip('c1'), kneadState };
    }

    it('accepts a clip with a valid kneadState', () => {
        const clip = clipWithKnead({
            blobs: [
                {
                    id: 'blob-1',
                    startTime: 0,
                    endTime: 1,
                    pitchCenterCents: 50,
                    voicedConfidence: 0.9,
                    pitchCurveCents: [0, 10, 20],
                },
            ],
            retuneSpeedMs: 50,
            humanizePercent: 0.2,
            formantPreserve: true,
        });
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(true);
    });

    it('rejects a kneadState with non-boolean formantPreserve', () => {
        const clip = clipWithKnead({ blobs: [], retuneSpeedMs: 50, humanizePercent: 0.2, formantPreserve: 'yes' });
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects a kneadState with non-finite retuneSpeedMs', () => {
        const clip = clipWithKnead({
            blobs: [],
            retuneSpeedMs: Number.NaN,
            humanizePercent: 0.2,
            formantPreserve: false,
        });
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects a kneadState blob with a non-number pitchCurveCents entry', () => {
        const clip = clipWithKnead({
            blobs: [
                {
                    id: 'blob-1',
                    startTime: 0,
                    endTime: 1,
                    pitchCenterCents: 0,
                    voicedConfidence: 1,
                    pitchCurveCents: [0, 'bad', 20],
                },
            ],
            retuneSpeedMs: 50,
            humanizePercent: 0.2,
            formantPreserve: false,
        });
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects a kneadState with a missing blobs array', () => {
        const clip = clipWithKnead({ retuneSpeedMs: 50, humanizePercent: 0.2, formantPreserve: false });
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('accepts a kneadState blob with a valid originalPitchCenterCents', () => {
        const clip = clipWithKnead({
            blobs: [
                {
                    id: 'blob-1',
                    startTime: 0,
                    endTime: 1,
                    pitchCenterCents: 0,
                    voicedConfidence: 1,
                    pitchCurveCents: [0],
                    originalPitchCenterCents: 10,
                },
            ],
            retuneSpeedMs: 50,
            humanizePercent: 0.2,
            formantPreserve: false,
        });
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(true);
    });

    it('rejects a kneadState blob with a non-finite originalPitchCenterCents', () => {
        const clip = clipWithKnead({
            blobs: [
                {
                    id: 'blob-1',
                    startTime: 0,
                    endTime: 1,
                    pitchCenterCents: 0,
                    voicedConfidence: 1,
                    pitchCurveCents: [0],
                    originalPitchCenterCents: Number.NaN,
                },
            ],
            retuneSpeedMs: 50,
            humanizePercent: 0.2,
            formantPreserve: false,
        });
        expect(
            isPromotableRuntimeClipCollection({
                value: [clip],
                targetTrackId: 't1',
                tracks: minimalTracks(),
                source: SOURCE,
            })
        ).toBe(false);
    });
});

describe('isPromotableRuntimeClipCollection — malformed alternative and non-array clip collections', () => {
    it('rejects when an external alternative is not a record', () => {
        // A corrupted alternative object makes hasExternalClipIdCollision bail.
        const tracks = [
            { id: 't1', clips: [], alternatives: [] },
            { id: 't2', clips: [], alternatives: ['not-an-alternative'] },
        ];
        expect(
            isPromotableRuntimeClipCollection({
                value: [validClip('c1')],
                targetTrackId: 't1',
                tracks,
                source: SOURCE,
            })
        ).toBe(false);
    });

    it('rejects when an external track clips collection is not an array', () => {
        // collectionContainsSelectedId must treat a non-array as a malformed
        // collision (null) rather than iterating.
        const tracks = [
            { id: 't1', clips: [], alternatives: [] },
            { id: 't2', clips: 'not-an-array', alternatives: [] },
        ];
        expect(
            isPromotableRuntimeClipCollection({
                value: [validClip('c1')],
                targetTrackId: 't1',
                tracks,
                source: SOURCE,
            })
        ).toBe(false);
    });
});
