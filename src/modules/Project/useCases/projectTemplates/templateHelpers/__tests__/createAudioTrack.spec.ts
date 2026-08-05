import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createTrack: vi.fn(() => ({ id: 'track-1', name: '', kind: 'audio', devices: [], color: '#fff', gain: 0, pan: 0 })),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({ createTrack: mocks.createTrack }));

import { createAudioTrack } from '../createAudioTrack';

describe('createAudioTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates a track with kind audio and forwards name/parentId', () => {
        createAudioTrack({ name: 'My Track', parentId: 'folder-1' });
        expect(mocks.createTrack).toHaveBeenCalledExactlyOnceWith({
            name: 'My Track',
            kind: 'audio',
            parentId: 'folder-1',
        });
    });

    it('maps devices through buildDevice when provided', () => {
        const track = createAudioTrack({
            name: 'X',
            devices: [{ type: 'builtin-eq', name: 'EQ', params: {} }],
        });
        expect(track.devices).toHaveLength(1);
        expect(track.devices[0]?.type).toBe('builtin-eq');
    });

    it('defaults to an empty device chain when no devices provided', () => {
        const track = createAudioTrack({ name: 'X' });
        expect(track.devices).toEqual([]);
    });

    it('applies color/gain/pan overrides when provided', () => {
        const track = createAudioTrack({ name: 'X', color: '#ff0000', gain: 0.5, pan: -0.25 });
        expect(track.color).toBe('#ff0000');
        expect(track.gain).toBe(0.5);
        expect(track.pan).toBe(-0.25);
    });

    it('leaves color/gain/pan unchanged when overrides are omitted', () => {
        const track = createAudioTrack({ name: 'X' });
        // The mock returns gain: 0, pan: 0, color: '#fff' — createAudioTrack should not touch them
        expect(track.color).toBe('#fff');
        expect(track.gain).toBe(0);
        expect(track.pan).toBe(0);
    });
});
