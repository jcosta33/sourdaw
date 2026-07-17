import { describe, it, expect } from 'vitest';

import { createFindDeviceRef, encodeGlutenValue } from '../helpers';

import type { Device, Track } from '#/modules/Arrangement/stores';

// Fix 5 — typed fixture: the Track/Device TYPES come from the compliant
// Arrangement stores barrel (type-only, erased at runtime), so the factory
// satisfies createFindDeviceRef's real GetAllTracksFn contract. Field values
// are copied field-identical from Arrangement's TrackDummy.
function trackWithDevices(id: string, deviceIds: string[]): Track {
    const devices: Device[] = deviceIds.map((deviceId) => ({
        id: deviceId,
        name: deviceId,
        type: 'gluten',
        bypassed: false,
        parameterValues: {},
    }));
    return {
        id,
        name: id,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices,
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
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
