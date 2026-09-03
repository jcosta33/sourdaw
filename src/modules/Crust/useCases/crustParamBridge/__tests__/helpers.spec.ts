import { describe, it, expect } from 'vitest';

import { type Device, type Track } from '#/modules/Arrangement/stores';

import { createFindDeviceRef, encodeCrustValue, STYLE_TO_ALGORITHM } from '../helpers';

function createDevice(id: string): Device {
    return {
        id,
        name: id,
        type: 'crust',
        bypassed: false,
        parameterValues: {},
    };
}

function createTrack(input: { id: string; deviceIds: string[] }): Track {
    return {
        id: input.id,
        name: input.id,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: input.deviceIds.map(createDevice),
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

describe('encodeCrustValue', () => {
    // Each enum-backed key maps a known string to its index. These guard the
    // happy path so the null-on-miss change below cannot silently break valid
    // encoding.
    it.each([
        ['style', 'transparent', 0],
        ['style', 'punchy', 1],
        ['algorithm', 'transparent', 0],
        ['algorithm', 'aggressive', 4],
        ['satAlgorithm', 'soft', 0],
        ['satAlgorithm', 'tube', 3],
        ['multiBand', 'wideband', 0],
        ['multiBand', '5band', 2],
        ['stereoMode', 'stereo', 0],
        ['stereoMode', 'ms', 1],
        ['dither', 'off', 0],
        ['dither', 'powr2', 4],
        ['scrollSpeed', 'slow', 0],
        ['scrollSpeed', 'fast', 2],
    ])('should encode known %s value %s to index %d', (key, value, expected) => {
        expect(encodeCrustValue(key, value)).toBe(expected);
    });

    // Regression: an unrecognised enum string used to coerce to the first
    // valid index (`?? 0`, or `?? 1` for scrollSpeed), silently sending the
    // engine a wrong value while the store kept the bad string. It must now
    // return null so the write is skipped entirely.
    it.each([
        ['style', 'brutal'],
        ['algorithm', 'nonsense'],
        ['satAlgorithm', 'plasma'],
        ['multiBand', '7band'],
        ['stereoMode', 'quad'],
        ['dither', 'powr9'],
        ['scrollSpeed', 'glacial'],
    ])('should return null for an unknown %s value %s instead of coercing to a valid index', (key, value) => {
        expect(encodeCrustValue(key, value)).toBeNull();
    });

    it('should encode numbers and booleans directly', () => {
        expect(encodeCrustValue('gain', 7.5)).toBe(7.5);
        expect(encodeCrustValue('truePeak', true)).toBe(1);
        expect(encodeCrustValue('satEnabled', false)).toBe(0);
    });

    it('should return undefined for store-only string keys', () => {
        expect(encodeCrustValue('name', 'Init')).toBeUndefined();
        expect(encodeCrustValue('streamingPreset', 'ebu_r128')).toBeUndefined();
    });

    it('should return null for unencodable non-string values', () => {
        expect(encodeCrustValue('algorithm', null)).toBeNull();
        expect(encodeCrustValue('style', { label: 'transparent' })).toBeNull();
    });
});

describe('STYLE_TO_ALGORITHM', () => {
    // Same three pairs as Algorithm::from_style_index in crates/daw-dsp/src/crust/params.rs.
    it.each([
        ['transparent', 'transparent'],
        ['punchy', 'punchy'],
        ['loud', 'wall'],
    ] as const)('should map style %s to algorithm %s', (style, algorithm) => {
        expect(STYLE_TO_ALGORITHM[style]).toBe(algorithm);
    });
});

describe('createFindDeviceRef', () => {
    it('should return the owning track id and device id when the device exists', () => {
        const findDeviceRef = createFindDeviceRef(() => [
            createTrack({ id: 'track-1', deviceIds: ['device-1'] }),
            createTrack({ id: 'track-2', deviceIds: ['device-2'] }),
        ]);

        expect(findDeviceRef('device-2')).toEqual({ trackId: 'track-2', deviceId: 'device-2' });
    });

    it('should return null when the device does not exist', () => {
        const findDeviceRef = createFindDeviceRef(() => [createTrack({ id: 'track-1', deviceIds: ['device-1'] })]);

        expect(findDeviceRef('missing-device')).toBeNull();
    });
});
