import { afterEach, describe, expect, it } from 'vitest';

import { controlSurfaceStore, type ControlSurfaceState } from '../../../stores/controlSurface';
import { mcuSetFader } from '../mcuSetFader';

const initialState = controlSurfaceStore.value;
afterEach(() => controlSurfaceStore.set(initialState));

describe('mcuSetFader', () => {
    it('rounds and clamps one fader while preserving the rest of the state and input', () => {
        const fixture: ControlSurfaceState = {
            protocol: 'mcu',
            connected: true,
            mcu: {
                faders: Array.from({ length: 9 }, (_, index) => ({
                    position: 100 + index * 73,
                    trackIndex: 20 + index,
                })),
                bankOffset: 16,
                vpots: [1, 2, 3, 4, 5, 6, 7, 8],
                mode: 'plugin',
                timecodeDisplay: '01:23:45:06',
                assignmentDisplay: 'FX',
            },
            oscEndpoints: [{ id: 'endpoint', host: 'localhost', sendPort: 9000, receivePort: 9001, active: true }],
            oscMappings: [{ oscAddress: '/gain', actionType: 'gain', parameterPath: 'track.2.gain', min: 0, max: 1 }],
        };
        const original = structuredClone(fixture);
        controlSurfaceStore.set(fixture);
        const expected = structuredClone(original);
        expected.mcu.faders[2]!.position = 513;
        mcuSetFader(2, 512.6);
        expect(controlSurfaceStore.value).toEqual(expected);
        expect(fixture).toEqual(original);
        expected.mcu.faders[2]!.position = 1023;
        expected.mcu.faders[0]!.position = 0;
        mcuSetFader(2, 1023.6);
        mcuSetFader(0, -50);
        expect(controlSurfaceStore.value).toEqual(expected);
        expect(fixture).toEqual(original);
    });

    it('is a no-op when the control surface has no state', () => {
        controlSurfaceStore.set(null);
        mcuSetFader(0, 500);
        expect(controlSurfaceStore.value).toBeNull();
    });
});
