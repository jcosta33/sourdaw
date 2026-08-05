import { describe, expect, it } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';

import { addSend } from '../addSend';

function makeTrack(id: string): Track {
    return {
        id,
        name: id,
        kind: 'audio',
        devices: [],
        sends: [],
        color: '#fff',
        gain: 0,
        pan: 0,
    } as unknown as Track;
}

describe('addSend', () => {
    it('adds a send from one track to another with the specified level', () => {
        const from = makeTrack('source');
        const to = makeTrack('bus-1');
        addSend({ from, to, level: 0.5 });
        expect(from.sends).toHaveLength(1);
        expect(from.sends[0]).toEqual({ busId: 'bus-1', level: 0.5, preFader: false });
    });

    it('defaults preFader to false when not specified', () => {
        const from = makeTrack('source');
        const to = makeTrack('bus-1');
        addSend({ from, to, level: 0.3 });
        expect(from.sends[0]?.preFader).toBe(false);
    });

    it('sets preFader to true when specified', () => {
        const from = makeTrack('source');
        const to = makeTrack('bus-1');
        addSend({ from, to, level: 0.3, preFader: true });
        expect(from.sends[0]?.preFader).toBe(true);
    });

    it('replaces an existing send to the same bus rather than duplicating', () => {
        const from = makeTrack('source');
        const to = makeTrack('bus-1');
        addSend({ from, to, level: 0.3 });
        addSend({ from, to, level: 0.7 });
        expect(from.sends).toHaveLength(1);
        expect(from.sends[0]?.level).toBe(0.7);
    });

    it('keeps sends to different buses separate', () => {
        const from = makeTrack('source');
        const busA = makeTrack('bus-a');
        const busB = makeTrack('bus-b');
        addSend({ from, to: busA, level: 0.3 });
        addSend({ from, to: busB, level: 0.5 });
        expect(from.sends).toHaveLength(2);
    });
});
