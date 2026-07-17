import { describe, it, expect } from 'vitest';

import { createFindDeviceRef, encodeGlutenValue } from '../helpers';

// Fix 5 — build tracks from a local, field-identical factory instead of
// importing Arrangement's Track model across the module boundary. Tests use
// contract barrels only; models stay private. `createFindDeviceRef` reads only
// `track.id` and `track.devices[].id`, so these local shapes are faithful.
type LocalDevice = {
    id: string;
    name: string;
    type: string;
    bypassed: boolean;
    parameterValues: Record<string, number>;
};

type LocalTrack = {
    id: string;
    name: string;
    kind: 'audio' | 'midi' | 'bus' | 'master' | 'folder';
    devices: LocalDevice[];
};

function trackWithDevices(id: string, deviceIds: string[]): LocalTrack {
    const devices: LocalDevice[] = deviceIds.map((deviceId) => ({
        id: deviceId,
        name: deviceId,
        type: 'gluten',
        bypassed: false,
        parameterValues: {},
    }));
    return { id, name: id, kind: 'audio', devices };
}

describe('glutenParamBridge helpers', () => {
    describe('createFindDeviceRef', () => {
        it('should return track and device ids when the device exists', () => {
            const find = createFindDeviceRef(() => [
                trackWithDevices('t1', ['d1', 'd2']),
                trackWithDevices('t2', ['d3']),
            ]);

            expect(find('d2')).toEqual({ trackId: 't1', deviceId: 'd2' });
        });

        it('should return null when no track contains the device', () => {
            const find = createFindDeviceRef(() => [trackWithDevices('t1', ['d1'])]);
            expect(find('missing')).toBeNull();
        });
    });

    describe('encodeGlutenValue', () => {
        it('should pass numbers through', () => {
            expect(encodeGlutenValue('threshold', -18)).toBe(-18);
        });

        it('should encode booleans as 0 or 1', () => {
            expect(encodeGlutenValue('bypass', false)).toBe(0);
            expect(encodeGlutenValue('bypass', true)).toBe(1);
        });

        it('should map topology, style, detection, and stereoMode strings to indices', () => {
            expect(encodeGlutenValue('topology', 'fet')).toBe(2);
            expect(encodeGlutenValue('style', 'punch')).toBe(1);
            expect(encodeGlutenValue('detection', 'peak')).toBe(1);
            expect(encodeGlutenValue('stereoMode', 'dual-mono')).toBe(3);
        });

        it('should still map the legitimately-zero enum members to 0', () => {
            // Fix 2 — these members genuinely encode to index 0. The fix must keep
            // returning 0 for them (not null) while rejecting *unknown* strings.
            expect(encodeGlutenValue('topology', 'vca')).toBe(0);
            expect(encodeGlutenValue('style', 'glue')).toBe(0);
            expect(encodeGlutenValue('detection', 'rms')).toBe(0);
            expect(encodeGlutenValue('stereoMode', 'stereo')).toBe(0);
        });

        it('should return null — not 0 — for an unrecognized enum string', () => {
            // Fix 2 — the old `?? 0` fallback collapsed any unknown enum string to
            // index 0 (a valid member), silently desyncing the store from the
            // engine. An unrecognized member must now report a miss via null.
            expect(encodeGlutenValue('topology', 'tube')).toBeNull();
            expect(encodeGlutenValue('blendTopology', 'tube')).toBeNull();
            expect(encodeGlutenValue('style', 'crush')).toBeNull();
            expect(encodeGlutenValue('detection', 'envelope')).toBeNull();
            expect(encodeGlutenValue('stereoMode', 'binaural')).toBeNull();
        });

        it('should return null for unsupported value types', () => {
            expect(encodeGlutenValue('x', { a: 1 })).toBeNull();
        });

        it('should return null for unhandled string keys', () => {
            expect(encodeGlutenValue('threshold', 'not-a-number')).toBeNull();
        });
    });
});
