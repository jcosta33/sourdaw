import { describe, it, expect, vi, beforeEach } from 'vitest';

import { persistDeviceParam } from '../persistDeviceParam';
import { trackStore } from '../trackStore';

describe('persistDeviceParam (stores)', () => {
    beforeEach(() => {
        trackStore.set(null);
    });

    it('is a no-op when value is not finite', () => {
        const set = vi.spyOn(trackStore, 'set');
        trackStore.set({ tracks: [], selectedTrackId: null });
        set.mockClear();

        persistDeviceParam('d1', 'gain', Number.NaN);

        expect(set).not.toHaveBeenCalled();
    });

    it('is a no-op when store is uninitialised', () => {
        const set = vi.spyOn(trackStore, 'set');
        set.mockClear();

        persistDeviceParam('d1', 'gain', 0.5);

        expect(set).not.toHaveBeenCalled();
    });

    it('is a no-op when no track owns the device', () => {
        trackStore.set({
            tracks: [{ id: 't1', devices: [], clips: [] }] as any,
            selectedTrackId: null,
        });
        const set = vi.spyOn(trackStore, 'set');
        set.mockClear();

        persistDeviceParam('missing', 'gain', 0.5);

        expect(set).not.toHaveBeenCalled();
    });

    it('writes the new parameter value onto the owning device only', () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    devices: [
                        { id: 'd1', parameterValues: { gain: 0.1 } },
                        { id: 'd2', parameterValues: {} },
                    ],
                    clips: [],
                },
                {
                    id: 't2',
                    devices: [{ id: 'd3', parameterValues: {} }],
                    clips: [],
                },
            ] as any,
            selectedTrackId: null,
        });

        persistDeviceParam('d1', 'gain', 0.8);

        const updated = trackStore.value!;
        const device = (updated.tracks[0]!.devices as any[]).find((d) => d.id === 'd1');
        expect(device.parameterValues.gain).toBe(0.8);
        // Other devices / tracks untouched
        const other = (updated.tracks[0]!.devices as any[]).find((d) => d.id === 'd2');
        expect(other.parameterValues).toEqual({});
    });
});
