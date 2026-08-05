import { describe, expect, it } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';

import { attachSidechainCompressor } from '../attachSidechainCompressor';

function makeTrack(): Track {
    return {
        id: 't1',
        name: 'Test',
        kind: 'audio',
        devices: [],
        sends: [],
        color: '#fff',
        gain: 0,
        pan: 0,
    } as unknown as Track;
}

describe('attachSidechainCompressor', () => {
    it('appends a sidechain compressor device with default parameters', () => {
        const track = makeTrack();
        const deviceId = attachSidechainCompressor({ track });
        expect(deviceId).toMatch(/^dev-/);
        expect(track.devices).toHaveLength(1);
        const device = track.devices[0]!;
        expect(device.type).toBe('builtin-sidechain-compressor');
        expect(device.name).toBe('SC Comp');
        expect(device.parameterValues).toEqual({
            'sc-comp-threshold': -24,
            'sc-comp-ratio': 4,
            'sc-comp-attack': 5,
            'sc-comp-release': 180,
            'sc-comp-knee': 6,
            'sc-comp-makeup': 2,
        });
    });

    it('applies custom name and parameter overrides', () => {
        const track = makeTrack();
        attachSidechainCompressor({
            track,
            name: 'Kick Duck',
            threshold: -12,
            ratio: 8,
            attack: 2,
            release: 100,
            knee: 3,
            makeup: 4,
        });
        const device = track.devices[0]!;
        expect(device.name).toBe('Kick Duck');
        expect(device.parameterValues['sc-comp-threshold']).toBe(-12);
        expect(device.parameterValues['sc-comp-ratio']).toBe(8);
    });

    it('preserves existing devices when appending', () => {
        const track = makeTrack();
        attachSidechainCompressor({ track, name: 'First' });
        attachSidechainCompressor({ track, name: 'Second' });
        expect(track.devices).toHaveLength(2);
        expect(track.devices[0]!.name).toBe('First');
        expect(track.devices[1]!.name).toBe('Second');
    });
});
