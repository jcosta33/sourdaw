import { describe, it, expect } from 'vitest';
import { TrackDummy } from '../../../../Arrangement/__tests__/TrackDummy';
import { hasToasterDevice } from '../hasToasterDevice';

describe('hasToasterDevice', () => {
    it('should return false when there is no toaster device', () => {
        const track = TrackDummy.create({
            devices: [
                {
                    id: 'd1',
                    name: 'Gain',
                    type: 'gain',
                    bypassed: false,
                    parameterValues: {},
                },
            ],
        });
        expect(hasToasterDevice(track)).toBe(false);
    });

    it('should return true when a toaster device exists', () => {
        const track = TrackDummy.create({
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
        expect(hasToasterDevice(track)).toBe(true);
    });
});
