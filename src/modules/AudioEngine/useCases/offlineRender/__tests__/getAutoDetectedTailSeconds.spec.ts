import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: null as { tracks: unknown[] } | null },
}));

import { trackStore } from '#/modules/Arrangement/stores';

import * as estimateMod from '../../../services/estimateRenderTailSeconds';
import { getAutoDetectedTailSeconds } from '../getAutoDetectedTailSeconds';

type MutableTrackStore = { value: { tracks: unknown[] } | null };
const mockTrackStore = trackStore as unknown as MutableTrackStore;

function makeTrack(devices: Array<{ type: string; parameterValues?: Record<string, number>; bypassed?: boolean }>) {
    return {
        devices: devices.map((d) => ({
            type: d.type,
            parameterValues: d.parameterValues ?? {},
            bypassed: d.bypassed ?? false,
        })),
    };
}

describe('getAutoDetectedTailSeconds', () => {
    beforeEach(() => {
        mockTrackStore.value = null;
        vi.restoreAllMocks();
    });

    it('projects each track device shape into estimateRenderTailSeconds', () => {
        // Reverb decay of 4s is the dominant tail; expected result 4 (clamped to <=30).
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 4 } }]),
                makeTrack([{ type: 'builtin-eq' }]),
            ],
        };

        expect(getAutoDetectedTailSeconds()).toBe(4);
    });

    it('skips bypassed devices so their tail no longer counts', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 4 }, bypassed: true }]),
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 1.5 } }]),
            ],
        };

        expect(getAutoDetectedTailSeconds()).toBe(1.5);
    });

    it('returns 0 when the track store has no state', () => {
        mockTrackStore.value = null;
        expect(getAutoDetectedTailSeconds()).toBe(0);
    });

    it('forwards the mapped device projection (type/parameterValues/bypassed) verbatim', () => {
        const spy = vi.spyOn(estimateMod, 'estimateRenderTailSeconds');
        mockTrackStore.value = {
            tracks: [makeTrack([{ type: 'builtin-delay', parameterValues: { 'delay-time': 300 } }])],
        };

        getAutoDetectedTailSeconds();
        expect(spy).toHaveBeenCalledTimes(1);
        const projected = spy.mock.calls[0]![0];
        expect(projected).toEqual([
            {
                devices: [
                    { type: 'builtin-delay', parameterValues: { 'delay-time': 300 }, bypassed: false },
                ],
            },
        ]);
    });
});
