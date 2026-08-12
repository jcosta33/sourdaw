import { describe, expect, it } from 'vitest';

import { createTrack, normalizeTrack } from '../Track';

describe('createTrack', () => {
    it('uses a provided id and skips random track ids', () => {
        const time = createTrack({ id: 'fixed-id', name: 'A', kind: 'audio' });
        expect(time.id).toBe('fixed-id');
        expect(time.name).toBe('A');
        expect(time.kind).toBe('audio');
        expect(time.devices).toEqual([]);
    });

    it('assigns the master id and routing for the master track', () => {
        const time = createTrack({ name: 'Master', kind: 'master' });
        expect(time.id).toBe('master');
        expect(time.outputId).toBe('hw_out');
    });

    it('adds a default synth device for MIDI tracks', () => {
        const time = createTrack({ name: 'Keys', kind: 'midi' });
        expect(time.devices).toHaveLength(1);
        expect(time.devices[0]!.type).toBe('builtin-synth');
        expect(time.devices[0]!.name).toBe('Synth');
    });

    it('preserves an application-owned MIDI device identity', () => {
        const track = createTrack({
            id: 'midi-1',
            initialAlternativeId: 'alternative-1',
            initialDeviceId: 'device-1',
            name: 'Keys',
            kind: 'midi',
        });

        expect(track.activeAlternativeId).toBe('alternative-1');
        expect(track.devices[0]?.id).toBe('device-1');
    });

    it('preserves application-owned replay color and alternative identity', () => {
        const track = createTrack({
            id: 'bus-1',
            name: 'Vocal Reverb',
            kind: 'bus',
            color: '#123456',
            initialAlternativeId: 'bus-1-alt-default',
        });

        expect(track.color).toBe('#123456');
        expect(track.activeAlternativeId).toBe('bus-1-alt-default');
        expect(track.alternatives).toEqual([{ id: 'bus-1-alt-default', name: 'Alternative 1', clips: [] }]);
    });

    it('uses an application-owned initial gain when creating a track', () => {
        const track = createTrack({ name: 'Unity Bus', kind: 'bus', gain: 1 });

        expect(track.gain).toBe(1);
    });
});

describe('normalizeTrack', () => {
    it('fills freezeState when missing from persisted data', () => {
        const time = normalizeTrack({ id: 't1', name: 'Old', kind: 'audio' });
        expect(time.freezeState).toEqual({ status: 'unfrozen' });
    });

    it('preserves an existing freezeState', () => {
        const time = normalizeTrack({
            id: 't1',
            name: 'Frozen',
            kind: 'audio',
            freezeState: { status: 'frozen', frozenBufferId: 'buf-1' },
        });
        expect(time.freezeState.status).toBe('frozen');
        expect(time.freezeState.frozenBufferId).toBe('buf-1');
    });

    it('defaults midiFx name from type when absent', () => {
        const time = normalizeTrack({
            id: 't1',
            name: 'MIDI',
            kind: 'midi',
            midiFx: [{ id: 'fx1', type: 'arp' } as never],
        });
        expect(time.midiFx[0]!.name).toBe('Arp');
    });

    it('routes non-master tracks to the master bus by default', () => {
        const time = normalizeTrack({ id: 't1', name: 'A', kind: 'audio' });
        expect(time.outputId).toBe('master');
    });

    it('routes master to hardware output by default', () => {
        const time = normalizeTrack({ id: 't1', name: 'Master', kind: 'master' });
        expect(time.outputId).toBe('hw_out');
    });
});
