import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';
import { canonicalJson } from '#/utils/canonicalDigest';
import { handleDetectTransients, transientStateMatches } from '../handleDetectTransients';

const mocks = vi.hoisted(() => ({ detect: vi.fn(), notice: vi.fn() }));
vi.mock('#/modules/ElasticAudio/useCases', () => ({ detectTransientsForClip: mocks.detect }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notice }));

function changedMarkerField(key: string): boolean | string | number {
    if (key === 'locked') {
        return false;
    }
    if (key === 'id' || key === 'origin') {
        return 'changed';
    }
    return 0.1;
}

describe('Arrangement Detect owns async admission and notification', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        preferencesStore.trySet(defaultPreferences);
    });
    it.each([undefined, 0.9])('awaits failure and uses explicit or persisted sensitivity %s', async (sensitivity) => {
        preferencesStore.trySet({ ...defaultPreferences, elasticTransientSensitivity: 0.82 });
        let fail: ((value: { status: 'failed'; code: 'analysis-failed' }) => void) | undefined;
        mocks.detect.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    fail = resolve;
                })
        );
        const action = { type: 'detectTransients' as const, payload: { clipId: 'clip-1', sensitivity } };
        handleDetectTransients.describe(action);
        const result = handleDetectTransients.execute(action);
        expect(mocks.notice).not.toHaveBeenCalled();
        expect(mocks.detect).toHaveBeenCalledWith('clip-1', sensitivity ?? 0.82, undefined);
        fail?.({ status: 'failed', code: 'analysis-failed' });
        expect(await result).toEqual({ status: 'conflict', reason: 'Transient detection failed: analysis-failed' });
        expect(mocks.notice).toHaveBeenCalledWith('Transient detection failed: analysis-failed', 'error');
        expect(handleDetectTransients.undoable).toBe(true);
    });
});

describe('prospective transient-state equality preserves the canonical oracle', () => {
    const marker = {
        id: 'locked-auto',
        originalBeat: 0.8,
        warpedBeat: 1.1,
        origin: 'transient-auto',
        confidence: 0.73,
        locked: true,
    };
    const state = { enabled: true, markers: [marker], stretchMode: 'repitch', originalTempo: 120 };
    const variants: unknown[] = [
        state,
        {
            originalTempo: 120,
            stretchMode: 'repitch',
            markers: [
                {
                    locked: true,
                    confidence: 0.73,
                    origin: 'transient-auto',
                    warpedBeat: 1.1,
                    originalBeat: 0.8,
                    id: 'locked-auto',
                },
            ],
            enabled: true,
        },
        { ...state, enabled: false },
        { ...state, stretchMode: 'wsola' },
        { ...state, originalTempo: 121 },
        { ...state, markers: [] },
        { ...state, unexpected: true },
        ...Object.keys(marker).map((key) => ({
            ...state,
            markers: [{ ...marker, [key]: changedMarkerField(key) }],
        })),
        { ...state, markers: [{ ...marker, unexpected: true }] },
        { ...state, markers: [{ ...marker, confidence: undefined }] },
        { ...state, markers: [{ id: marker.id, originalBeat: marker.originalBeat, warpedBeat: marker.warpedBeat }] },
        { ...state, markers: [marker, { ...marker, id: 'other' }] },
        { ...state, markers: [{ ...marker, id: 'other' }, marker] },
        { ...state, originalTempo: null },
        { ...state, originalTempo: undefined },
        { ...state, markers: [{ ...marker, originalBeat: -0 }] },
        { ...state, markers: [{ ...marker, originalBeat: 0 }] },
        [],
        { a: undefined },
        { b: undefined },
        [undefined],
        Array(1),
        [null],
        [Number.NaN],
        [Number.POSITIVE_INFINITY],
    ];
    it('agrees exactly for full fields, optional keys, unexpected structure and scalar edge cases', () => {
        for (const actual of variants) {
            for (const expected of variants) {
                expect(transientStateMatches(actual, expected)).toBe(canonicalJson(actual) === canonicalJson(expected));
            }
        }
    });
    it.each(['id', 'originalBeat', 'warpedBeat', 'origin', 'confidence', 'locked'] as const)(
        'rejects changed marker %s',
        (key) => {
            const changed = {
                ...state,
                markers: [{ ...marker, [key]: changedMarkerField(key) }],
            };
            expect(transientStateMatches(changed, state)).toBe(false);
        }
    );
});
