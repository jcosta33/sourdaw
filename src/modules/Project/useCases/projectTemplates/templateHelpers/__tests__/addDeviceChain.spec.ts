import { describe, expect, it } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';

import { addDeviceChain } from '../addDeviceChain';

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

describe('addDeviceChain', () => {
    it('appends new devices to the existing chain', () => {
        const track = makeTrack();
        addDeviceChain(track, [
            { type: 'builtin-eq', name: 'EQ' },
            { type: 'builtin-compressor', name: 'Comp' },
        ]);
        expect(track.devices).toHaveLength(2);
        expect(track.devices[0]?.type).toBe('builtin-eq');
        expect(track.devices[1]?.type).toBe('builtin-compressor');
    });

    it('preserves existing devices when adding more', () => {
        const track = makeTrack();
        addDeviceChain(track, [{ type: 'builtin-eq' }]);
        addDeviceChain(track, [{ type: 'builtin-reverb' }]);
        expect(track.devices).toHaveLength(2);
        expect(track.devices[0]?.type).toBe('builtin-eq');
        expect(track.devices[1]?.type).toBe('builtin-reverb');
    });
});
