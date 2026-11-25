import { describe, expect, it } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';

import { setMasterChain } from '../setMasterChain';

function makeMasterTrack(): Track {
    return {
        id: 'master',
        name: 'Master',
        kind: 'master',
        devices: [],
        sends: [],
        color: '#fff',
        gain: 0,
        pan: 0,
    } as unknown as Track;
}

describe('setMasterChain', () => {
    it('applies the pop preset with EQ, Gluten compressor, Proof, and LUFS meter', () => {
        const track = makeMasterTrack();
        setMasterChain(track, 'pop');
        const types = track.devices.map((d) => d.type);
        expect(types).toContain('builtin-eq');
        expect(types).toContain('gluten');
        expect(types).toContain('proof');
        expect(types).toContain('builtin-lufs-meter');
    });

    it('applies different device counts for different presets', () => {
        const popTrack = makeMasterTrack();
        setMasterChain(popTrack, 'pop');
        const edmTrack = makeMasterTrack();
        setMasterChain(edmTrack, 'edm');
        // EDM has an extra limiter (5 devices vs pop's 4)
        expect(edmTrack.devices.length).toBeGreaterThan(popTrack.devices.length);
    });

    it('replaces existing devices on the master track', () => {
        const track = makeMasterTrack();
        track.devices = [{ id: 'old', type: 'old-device', name: 'Old', bypassed: false, parameterValues: {} }];
        setMasterChain(track, 'rock');
        expect(track.devices.every((d) => d.type !== 'old-device')).toBe(true);
    });

    it('applies all 9 presets without error', () => {
        for (const preset of [
            'pop',
            'hiphop',
            'edm',
            'rock',
            'lofi',
            'cinematic',
            'podcast',
            'songwriter',
            'ambient',
        ] as const) {
            const track = makeMasterTrack();
            setMasterChain(track, preset);
            expect(track.devices.length).toBeGreaterThan(0);
        }
    });

    it.each([
        ['edm', 'Brickwall'],
        ['rock', 'Brickwall'],
        ['podcast', 'Broadcast Limit'],
    ] as const)('states Auto Makeup on in the %s master limiter', (preset, limiterName) => {
        const track = makeMasterTrack();
        setMasterChain(track, preset);

        const limiter = track.devices.find((device) => device.type === 'builtin-limiter');

        expect(limiter?.name).toBe(limiterName);
        expect(limiter?.parameterValues['lim-auto-makeup']).toBe(1);
    });
});
