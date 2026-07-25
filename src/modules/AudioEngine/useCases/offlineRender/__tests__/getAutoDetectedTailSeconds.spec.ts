import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: null as { tracks: unknown[] } | null },
}));

import { trackStore } from '#/modules/Arrangement/stores';

import * as estimateMod from '../../../services/estimateRenderTailSeconds';
import { getAutoDetectedTailSeconds } from '../getAutoDetectedTailSeconds';

const DELAY_TAIL = {
    kind: 'feedbackLoop',
    feedbackParameterId: 'delay-feedback',
    defaultFeedback: 0.4,
    maxFeedback: 0.95,
    loopParameterId: 'delay-time',
    loopUnit: 'ms',
    defaultLoopSeconds: 0.25,
} as const;

const REVERB_TAIL = { kind: 'decaySeconds', parameterId: 'rev-decay', defaultSeconds: 2 } as const;

/** Stands in for the descriptor lookup the export dialog injects. */
const tailForDeviceType = (deviceType: string) => {
    if (deviceType === 'builtin-reverb') {
        return REVERB_TAIL;
    }
    if (deviceType === 'builtin-delay') {
        return DELAY_TAIL;
    }
    return undefined;
};

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

        expect(getAutoDetectedTailSeconds({ tailForDeviceType })).toBe(4);
    });

    it('skips bypassed devices so their tail no longer counts', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 4 }, bypassed: true }]),
                makeTrack([{ type: 'builtin-reverb', parameterValues: { 'rev-decay': 1.5 } }]),
            ],
        };

        expect(getAutoDetectedTailSeconds({ tailForDeviceType })).toBe(1.5);
    });

    it('returns 0 when the track store has no state', () => {
        mockTrackStore.value = null;
        expect(getAutoDetectedTailSeconds({ tailForDeviceType })).toBe(0);
    });

    it('forwards the device projection together with the descriptor-declared tail', () => {
        const spy = vi.spyOn(estimateMod, 'estimateRenderTailSeconds');
        mockTrackStore.value = {
            tracks: [makeTrack([{ type: 'builtin-delay', parameterValues: { 'delay-time': 300 } }])],
        };

        getAutoDetectedTailSeconds({ tailForDeviceType });
        expect(spy).toHaveBeenCalledTimes(1);
        const projected = spy.mock.calls[0]![0];
        // The tail declaration has to come from the device's own descriptor —
        // the estimator is pure and cannot look it up itself, so a missing
        // lookup here silently turns every tail into zero.
        expect(projected).toEqual([
            {
                devices: [
                    {
                        type: 'builtin-delay',
                        parameterValues: { 'delay-time': 300 },
                        bypassed: false,
                        tail: {
                            kind: 'feedbackLoop',
                            feedbackParameterId: 'delay-feedback',
                            defaultFeedback: 0.4,
                            maxFeedback: 0.95,
                            loopParameterId: 'delay-time',
                            loopUnit: 'ms',
                            defaultLoopSeconds: 0.25,
                        },
                    },
                ],
            },
        ]);
    });

    it('leaves a device with no declared tail undeclared in the projection', () => {
        const spy = vi.spyOn(estimateMod, 'estimateRenderTailSeconds');
        mockTrackStore.value = { tracks: [makeTrack([{ type: 'builtin-eq' }])] };

        getAutoDetectedTailSeconds({ tailForDeviceType });
        const projected = spy.mock.calls[0]![0];
        expect(projected[0]!.devices[0]!.tail).toBeUndefined();
    });
});
