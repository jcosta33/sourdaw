import { describe, expect, it } from 'vitest';

import { createTrack, normalizeTrack } from '../Track';

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

describe('normalizeTrack', () => {
    it('fills freezeState when missing from persisted data', () => {
        const t = normalizeTrack({ id: 't1', name: 'Old', kind: 'audio' });
        expect(t.freezeState).toEqual({ status: 'unfrozen' });
    });

    it('preserves an existing freezeState', () => {
        const t = normalizeTrack({
            id: 't1',
            name: 'Frozen',
            kind: 'audio',
            freezeState: { status: 'frozen', frozenBufferId: 'buf-1' },
        });
        expect(t.freezeState.status).toBe('frozen');
        expect(t.freezeState.frozenBufferId).toBe('buf-1');
    });

    it('defaults midiFx name from type when absent', () => {
        const t = normalizeTrack({
            id: 't1',
            name: 'MIDI',
            kind: 'midi',
            midiFx: [{ id: 'fx1', type: 'arp' } as never],
        });
        expect(t.midiFx[0]!.name).toBe('Arp');
    });

    it('routes non-master tracks to the master bus by default', () => {
        const t = normalizeTrack({ id: 't1', name: 'A', kind: 'audio' });
        expect(t.outputId).toBe('master');
    });

    it('routes master to hardware output by default', () => {
        const t = normalizeTrack({ id: 't1', name: 'Master', kind: 'master' });
        expect(t.outputId).toBe('hw_out');
    });
});
