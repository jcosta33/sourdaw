import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    createFindDeviceRef,
    createFlushHandlers,
    encodeGlutenValue,
    latestValues,
    pendingUpdates,
} from '../helpers';

describe('glutenParamBridge helpers', () => {
    beforeEach(() => {
        pendingUpdates.clear();
        latestValues.clear();
    });

    describe('createFindDeviceRef', () => {
        it('should return track and device ids when the device exists', () => {
            const find = createFindDeviceRef(() => [
                { id: 't1', devices: [{ id: 'd1' }, { id: 'd2' }] } as never,
                { id: 't2', devices: [{ id: 'd3' }] } as never,
            ]);

            expect(find('d2')).toEqual({ trackId: 't1', deviceId: 'd2' });
        });

        it('should return null when no track contains the device', () => {
            const find = createFindDeviceRef(() => [{ id: 't1', devices: [{ id: 'd1' }] } as never]);
            expect(find('missing')).toBeNull();
        });
    });

    describe('createFlushHandlers', () => {
        it('should flush latestValues into update and persist when a value exists', () => {
            const updateDeviceParam = vi.fn();
            const persistDeviceParam = vi.fn();
            const { flushParam } = createFlushHandlers({ updateDeviceParam, persistDeviceParam });
            const ref = { trackId: 't1', deviceId: 'dev' };

            latestValues.set('dev:gain', 0.75);
            pendingUpdates.set('dev:gain', 1);

            flushParam('dev', ref, 'gain');

            expect(pendingUpdates.has('dev:gain')).toBe(false);
            expect(latestValues.has('dev:gain')).toBe(false);
            expect(updateDeviceParam).toHaveBeenCalledWith('t1', 'dev', 'gain', 0.75);
            expect(persistDeviceParam).toHaveBeenCalledWith('dev', 'gain', 0.75);
        });

        it('should not call deps when there is no staged value', () => {
            const updateDeviceParam = vi.fn();
            const persistDeviceParam = vi.fn();
            const { flushParam } = createFlushHandlers({ updateDeviceParam, persistDeviceParam });
            const ref = { trackId: 't1', deviceId: 'dev' };

            flushParam('dev', ref, 'gain');

            expect(updateDeviceParam).not.toHaveBeenCalled();
            expect(persistDeviceParam).not.toHaveBeenCalled();
        });

        it('should push immediately through update and persist', () => {
            const updateDeviceParam = vi.fn();
            const persistDeviceParam = vi.fn();
            const { pushParamImmediately } = createFlushHandlers({ updateDeviceParam, persistDeviceParam });
            const ref = { trackId: 't1', deviceId: 'dev' };

            pushParamImmediately(ref, 'attack', 12);

            expect(updateDeviceParam).toHaveBeenCalledWith('t1', 'dev', 'attack', 12);
            expect(persistDeviceParam).toHaveBeenCalledWith('dev', 'attack', 12);
        });
    });

    describe('encodeGlutenValue', () => {
        it('should pass numbers through', () => {
            expect(encodeGlutenValue('threshold', -18)).toBe(-18);
        });

        it('should encode booleans as 0 or 1', () => {
            expect(encodeGlutenValue('bypass', false)).toBe(0);
            expect(encodeGlutenValue('bypass', true)).toBe(1);
        });

        it('should map topology, style, detection, and stereoMode strings to indices', () => {
            expect(encodeGlutenValue('topology', 'fet')).toBe(2);
            expect(encodeGlutenValue('style', 'punch')).toBe(1);
            expect(encodeGlutenValue('detection', 'peak')).toBe(1);
            expect(encodeGlutenValue('stereoMode', 'dual-mono')).toBe(3);
        });

        it('should return null for unsupported value types', () => {
            expect(encodeGlutenValue('x', { a: 1 })).toBeNull();
        });

        it('should return null for unhandled string keys', () => {
            expect(encodeGlutenValue('threshold', 'not-a-number')).toBeNull();
        });
    });
});
