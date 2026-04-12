import { describe, it, expect } from 'vitest';

import { createFindDeviceRef } from '../helpers';

describe('fermenterParamBridge helpers', () => {
    describe('createFindDeviceRef', () => {
        it('should return track and device ids when the device exists', () => {
            const find = createFindDeviceRef(() => [
                { id: 't1', devices: [{ id: 'd1' }] } as never,
                { id: 't2', devices: [{ id: 'd2' }, { id: 'd3' }] } as never,
            ]);

            expect(find('d3')).toEqual({ trackId: 't2', deviceId: 'd3' });
        });

        it('should return null when no track contains the device', () => {
            const find = createFindDeviceRef(() => []);
            expect(find('x')).toBeNull();
        });
    });
});
