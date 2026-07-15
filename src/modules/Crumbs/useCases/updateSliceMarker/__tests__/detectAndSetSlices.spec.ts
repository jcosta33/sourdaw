import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    detectOnsets: vi.fn(),
    setMarkers: vi.fn(),
    activeSample: { sampleId: 7 } as { sampleId: number } | null,
}));

vi.mock('../../../repositories/crumbsBridge/detectOnsets', () => ({
    detectOnsets: mocks.detectOnsets,
}));

vi.mock('../../../stores/crumbsStore', () => ({
    crumbsStore: {
        get value() {
            return { inst1: { activeSample: mocks.activeSample } };
        },
    },
}));

vi.mock('../../../stores/sliceStore', () => ({
    setMarkers: mocks.setMarkers,
}));

import { detectAndSetSlices } from '../detectAndSetSlices';

import type { SliceMarker } from '../../../models/CrumbsTypes';

function markersFromLastCall(): SliceMarker[] {
    const lastCall = mocks.setMarkers.mock.calls.at(-1);
    if (!lastCall) {
        throw new Error('setMarkers was not called');
    }
    return lastCall[1] as SliceMarker[];
}

describe('detectAndSetSlices', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.activeSample = { sampleId: 7 };
    });

    it('assigns each detected onset a globally-unique slice-prefixed id, not index-positional', async () => {
        mocks.detectOnsets.mockResolvedValueOnce({ positions: [10, 20, 30], algorithm: 'superflux' });

        await detectAndSetSlices('inst1', 'superflux');

        const markers = markersFromLastCall();
        expect(markers).toHaveLength(3);
        // Every id follows the manual `slice-${uuid}` namespace, never the old `onset-${i}`.
        for (const marker of markers) {
            expect(marker.id.startsWith('slice-')).toBe(true);
            expect(marker.id.startsWith('onset-')).toBe(false);
        }
        // Frame positions and labels still track the detected onsets in order.
        expect(markers.map((m) => m.framePosition)).toEqual([10, 20, 30]);
        expect(markers.map((m) => m.label)).toEqual(['S1', 'S2', 'S3']);
    });

    it('produces ids that do not collide across two detect runs of identical onset count', async () => {
        mocks.detectOnsets.mockResolvedValue({ positions: [10, 20], algorithm: 'superflux' });

        await detectAndSetSlices('inst1', 'superflux');
        const firstRun = markersFromLastCall().map((m) => m.id);

        await detectAndSetSlices('inst1', 'superflux');
        const secondRun = markersFromLastCall().map((m) => m.id);

        // Within a run, ids are unique.
        expect(new Set(firstRun).size).toBe(firstRun.length);
        // Across runs of the same count, ids never repeat — the old `onset-${i}`
        // scheme produced identical ids (`onset-0`, `onset-1`) on every run.
        const overlap = firstRun.filter((id) => secondRun.includes(id));
        expect(overlap).toEqual([]);
    });

    it('does not call setMarkers when there is no active sample', async () => {
        mocks.activeSample = null;

        await detectAndSetSlices('inst1', 'superflux');

        expect(mocks.detectOnsets).not.toHaveBeenCalled();
        expect(mocks.setMarkers).not.toHaveBeenCalled();
    });
});
