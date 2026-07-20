import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

// A single fake CRDT document the mocked primitives read and mutate, so the
// real `createAutomergeStorage` adapter configured by `kneadStore` exercises
// its `toCrdt` / `fromCrdt` callbacks against controllable state.
const fakeDoc: Record<string, unknown> = {};
let mutate_doc_call_count = 0;

import { kneadStore, defaultKneadState } from '../kneadStore';

function configureFakeCrdtPort(): void {
    configureAutomergeStoragePort({
        getDoc: () => fakeDoc,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            mutate_doc_call_count += 1;
            changeFn(fakeDoc);
        },
    });
}

async function flushRaf(): Promise<void> {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
}

describe('kneadStore persistence of transient analysis flags', () => {
    beforeEach(async () => {
        for (const key of Object.keys(fakeDoc)) {
            delete fakeDoc[key];
        }
        mutate_doc_call_count = 0;
        configureFakeCrdtPort();
        kneadStore.set(defaultKneadState);
        await flushRaf();
        mutate_doc_call_count = 0;
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('does not persist isAnalyzing / analysisProgress to the CRDT', async () => {
        kneadStore.set({ ...defaultKneadState, isAnalyzing: true, analysisProgress: 0.5 });
        await flushRaf();

        const persisted = fakeDoc.knead as Record<string, unknown>;
        expect(persisted).toBeDefined();
        expect(persisted).not.toHaveProperty('isAnalyzing');
        expect(persisted).not.toHaveProperty('analysisProgress');
        // Durable fields are still persisted.
        expect(persisted).toHaveProperty('clips');
        expect(persisted).toHaveProperty('contours');
    });

    it('resets a stale isAnalyzing flag from an older document on hydrate', () => {
        // Simulate a document persisted before the strip, or a mid-analysis crash.
        fakeDoc.knead = {
            activeClipId: null,
            clips: {},
            contours: {},
            isAnalyzing: true,
            analysisProgress: 0.7,
        };

        kneadStore.hydrate();

        expect(kneadStore.value?.isAnalyzing).toBe(false);
        expect(kneadStore.value?.analysisProgress).toBe(0);
    });

    it('should default malformed top-level CRDT state to safe idle state on hydrate', () => {
        fakeDoc.knead = 'not-knead-state';

        kneadStore.hydrate();

        expect(kneadStore.value).toEqual(defaultKneadState);
    });

    it('should drop malformed CRDT map entries and strip stale fields on hydrate', () => {
        fakeDoc.knead = {
            activeClipId: 'clip-valid',
            clips: {
                'clip-valid': {
                    clipId: 'clip-valid',
                    blobs: [
                        {
                            id: 'blob-valid',
                            startTime: 1,
                            endTime: 2,
                            pitchCenterCents: 1200,
                            originalPitchCenterCents: 1198,
                            pitchCurveCents: [1190, 1200, 1210],
                            voicedConfidence: 0.92,
                            driftPercent: 1.5,
                            vibratoDepthPercent: 2.5,
                            vibratoRateHz: 5.5,
                            formantShiftCents: 12,
                            gainDb: -3,
                            muted: false,
                            staleBlobField: 'drop-me',
                        },
                        {
                            id: 'blob-bad',
                            startTime: 1,
                            endTime: 'bad',
                            pitchCenterCents: 1200,
                            originalPitchCenterCents: 1198,
                            pitchCurveCents: [1190],
                            voicedConfidence: 0.8,
                            driftPercent: 1,
                            vibratoDepthPercent: 2,
                            vibratoRateHz: 5,
                            formantShiftCents: 10,
                            gainDb: -1,
                            muted: false,
                        },
                    ],
                    retuneSpeedMs: 45,
                    toleranceCents: 35,
                    toleranceTimeMs: 20,
                    humanizePercent: 12,
                    formantPreserve: true,
                    staleClipField: 'drop-me',
                },
                'clip-bad': {
                    clipId: 123,
                    blobs: [],
                    retuneSpeedMs: 45,
                    toleranceCents: 35,
                    toleranceTimeMs: 20,
                    humanizePercent: 12,
                    formantPreserve: true,
                },
            },
            contours: {
                'clip-valid': {
                    points: [
                        {
                            time_ms: 10,
                            frequency_hz: 440,
                            confidence: 0.8,
                            voiced: true,
                            stalePointField: 'drop-me',
                        },
                        {
                            time_ms: 11,
                            frequency_hz: 'bad',
                            confidence: 0.7,
                            voiced: true,
                        },
                    ],
                    sample_rate: 48000,
                    hop_size: 256,
                    algorithm: 123,
                    staleContourField: 'drop-me',
                },
                'contour-bad': {
                    points: [],
                    sample_rate: 'bad',
                    hop_size: 256,
                },
            },
            isAnalyzing: true,
            analysisProgress: 0.8,
            staleTopLevelField: 'drop-me',
        };

        kneadStore.hydrate();

        expect(kneadStore.value).toEqual({
            activeClipId: 'clip-valid',
            clips: {
                'clip-valid': {
                    clipId: 'clip-valid',
                    blobs: [
                        {
                            id: 'blob-valid',
                            startTime: 1,
                            endTime: 2,
                            pitchCenterCents: 1200,
                            originalPitchCenterCents: 1198,
                            pitchCurveCents: [1190, 1200, 1210],
                            voicedConfidence: 0.92,
                            driftPercent: 1.5,
                            vibratoDepthPercent: 2.5,
                            vibratoRateHz: 5.5,
                            formantShiftCents: 12,
                            gainDb: -3,
                            muted: false,
                        },
                    ],
                    retuneSpeedMs: 45,
                    toleranceCents: 35,
                    toleranceTimeMs: 20,
                    humanizePercent: 12,
                    formantPreserve: true,
                },
            },
            contours: {
                'clip-valid': {
                    points: [
                        {
                            time_ms: 10,
                            frequency_hz: 440,
                            confidence: 0.8,
                            voiced: true,
                        },
                    ],
                    sample_rate: 48000,
                    hop_size: 256,
                },
            },
            isAnalyzing: false,
            analysisProgress: 0,
        });
    });

    it('should not write back when hydrating clean valid CRDT state', async () => {
        fakeDoc.knead = {
            activeClipId: 'clip-valid',
            clips: {},
            contours: {
                'clip-valid': {
                    points: [],
                    sample_rate: 48000,
                    hop_size: 256,
                    algorithm: 'pyin',
                },
            },
        };

        kneadStore.hydrate();
        await flushRaf();

        expect(mutate_doc_call_count).toBe(0);
        expect(fakeDoc.knead).toEqual({
            activeClipId: 'clip-valid',
            clips: {},
            contours: {
                'clip-valid': {
                    points: [],
                    sample_rate: 48000,
                    hop_size: 256,
                    algorithm: 'pyin',
                },
            },
        });
        expect(kneadStore.value).toEqual({
            activeClipId: 'clip-valid',
            clips: {},
            contours: {
                'clip-valid': {
                    points: [],
                    sample_rate: 48000,
                    hop_size: 256,
                    algorithm: 'pyin',
                },
            },
            isAnalyzing: false,
            analysisProgress: 0,
        });
    });

    it('should drop prototype-polluting CRDT map keys on hydrate', () => {
        const valid_clip = {
            clipId: 'clip-safe',
            blobs: [],
            retuneSpeedMs: 45,
            toleranceCents: 35,
            toleranceTimeMs: 20,
            humanizePercent: 12,
            formantPreserve: true,
        };
        const valid_contour = {
            points: [],
            sample_rate: 48000,
            hop_size: 256,
        };

        fakeDoc.knead = {
            activeClipId: 'clip-safe',
            clips: {
                ['__proto__']: { ...valid_clip, clipId: 'polluted-proto' },
                constructor: { ...valid_clip, clipId: 'polluted-constructor' },
                prototype: { ...valid_clip, clipId: 'polluted-prototype' },
                'clip-safe': valid_clip,
            },
            contours: {
                ['__proto__']: valid_contour,
                constructor: valid_contour,
                prototype: valid_contour,
                'clip-safe': valid_contour,
            },
        };

        kneadStore.hydrate();

        expect(kneadStore.value?.clips).toEqual({ 'clip-safe': valid_clip });
        expect(kneadStore.value?.contours).toEqual({ 'clip-safe': valid_contour });
        expect(Object.getPrototypeOf(kneadStore.value?.clips)).toBe(Object.prototype);
        expect(Object.getPrototypeOf(kneadStore.value?.contours)).toBe(Object.prototype);
    });

    it('drops malformed clip entries and blob items at every nested sanitization boundary', () => {
        const valid_clip_fields = {
            retuneSpeedMs: 45,
            toleranceCents: 35,
            toleranceTimeMs: 20,
            humanizePercent: 12,
            formantPreserve: true,
        };
        const valid_blob_fields = {
            startTime: 0,
            endTime: 1,
            pitchCenterCents: 0,
            originalPitchCenterCents: 0,
            voicedConfidence: 1,
            driftPercent: 0,
            vibratoDepthPercent: 0,
            vibratoRateHz: 0,
            formantShiftCents: 0,
            gainDb: 0,
            muted: false,
        };

        fakeDoc.knead = {
            activeClipId: 'clip-ok',
            clips: {
                'clip-ok': { clipId: 'clip-ok', blobs: [], ...valid_clip_fields },
                'clip-not-a-record': 'not-a-record',
                'clip-blobs-not-array': { clipId: 'x', blobs: 'not-an-array', ...valid_clip_fields },
                'clip-blob-not-a-record': { clipId: 'y', blobs: ['not-a-record-blob'], ...valid_clip_fields },
                'clip-pitch-curve-not-array': {
                    clipId: 'z',
                    blobs: [{ id: 'blob-z', pitchCurveCents: 'not-an-array', ...valid_blob_fields }],
                    ...valid_clip_fields,
                },
                'clip-pitch-curve-bad-item': {
                    clipId: 'w',
                    blobs: [{ id: 'blob-w', pitchCurveCents: [1, 'oops', 3], ...valid_blob_fields }],
                    ...valid_clip_fields,
                },
            },
            contours: {},
        };

        kneadStore.hydrate();

        expect(kneadStore.value?.clips).toEqual({
            'clip-ok': { clipId: 'clip-ok', blobs: [], ...valid_clip_fields },
            'clip-blob-not-a-record': { clipId: 'y', blobs: [], ...valid_clip_fields },
            'clip-pitch-curve-not-array': { clipId: 'z', blobs: [], ...valid_clip_fields },
            'clip-pitch-curve-bad-item': { clipId: 'w', blobs: [], ...valid_clip_fields },
        });
    });

    it('drops malformed contour entries and filters non-record points from an otherwise valid contour', () => {
        fakeDoc.knead = {
            activeClipId: 'contour-ok',
            clips: {},
            contours: {
                'contour-ok': { points: [], sample_rate: 48000, hop_size: 256 },
                'contour-not-a-record': 'oops',
                'contour-points-not-array': { points: 'not-an-array', sample_rate: 48000, hop_size: 256 },
                'contour-point-not-a-record': { points: ['not-a-record-point'], sample_rate: 48000, hop_size: 256 },
            },
        };

        kneadStore.hydrate();

        expect(kneadStore.value?.contours).toEqual({
            'contour-ok': { points: [], sample_rate: 48000, hop_size: 256 },
            'contour-point-not-a-record': { points: [], sample_rate: 48000, hop_size: 256 },
        });
    });

    it('defaults clips and contours to empty maps when the top-level values are not records', () => {
        fakeDoc.knead = {
            activeClipId: 'x',
            clips: 'not-a-record',
            contours: 42,
        };

        kneadStore.hydrate();

        expect(kneadStore.value?.clips).toEqual({});
        expect(kneadStore.value?.contours).toEqual({});
    });
});
