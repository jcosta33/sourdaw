import { describe, it, expect } from 'vitest';
import { TrackDummy } from '../../../../Arrangement/__tests__/TrackDummy';
import { shouldCreateOfflineStrip } from '../shouldCreateOfflineStrip';

describe('shouldCreateOfflineStrip', () => {
    it('should return false for a folder track without a toaster', () => {
        const track = TrackDummy.create({
            kind: 'folder',
            devices: [],
        });
        expect(shouldCreateOfflineStrip(track)).toBe(false);
    });

    it('should return true for a non-folder track', () => {
        const track = TrackDummy.create({
            kind: 'audio',
            devices: [],
        });
        expect(shouldCreateOfflineStrip(track)).toBe(true);
    });

    it('should return true for a folder track that has a toaster device', () => {
        const track = TrackDummy.create({
            kind: 'folder',
            devices: [
                {
                    id: 'd1',
                    name: 'Toaster',
                    type: 'toaster',
                    bypassed: false,
                    parameterValues: {},
                },
            ],
        });
        expect(shouldCreateOfflineStrip(track)).toBe(true);
    });
});
