import { describe, expect, it } from 'vitest';

import { createTrack } from '../Track';

describe('createTrack', () => {
    it('uses a provided id and skips random track ids', () => {
        const t = createTrack({ id: 'fixed-id', name: 'A', kind: 'audio' });
        expect(t.id).toBe('fixed-id');
        expect(t.name).toBe('A');
        expect(t.kind).toBe('audio');
        expect(t.devices).toEqual([]);
    });

    it('assigns the master id and routing for the master track', () => {
        const t = createTrack({ name: 'Master', kind: 'master' });
        expect(t.id).toBe('master');
        expect(t.outputId).toBe('hw_out');
    });

    it('adds a default synth device for MIDI tracks', () => {
        const t = createTrack({ name: 'Keys', kind: 'midi' });
        expect(t.devices).toHaveLength(1);
        expect(t.devices[0]!.type).toBe('builtin-synth');
        expect(t.devices[0]!.name).toBe('Synth');
    });
});
