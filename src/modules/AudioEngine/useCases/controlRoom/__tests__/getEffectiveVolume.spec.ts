import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEffectiveVolume } from '../getEffectiveVolume';
import { type ControlRoomState } from '../../../stores/controlRoom';

const storeCell = vi.hoisted(() => ({
    value: null as ControlRoomState | null,
}));

vi.mock('../../../stores/controlRoom', () => ({
    controlRoomStore: {
        get value() {
            return storeCell.value;
        },
    },
}));

function baseState(overrides: Partial<ControlRoomState> = {}): ControlRoomState {
    return {
        monitors: [
            { id: 'm1', name: 'Main', gainDb: 0, active: true, calibrationDb: 1.5 },
            { id: 'm2', name: 'Alt', gainDb: 0, active: false, calibrationDb: -1 },
        ],
        activeMonitorId: 'm1',
        monitorVolume: -6,
        dimLevel: -12,
        dimActive: false,
        monoActive: false,
        referenceActive: false,
        talkbackActive: false,
        talkbackLevel: 0,
        cueMixes: [],
        activeCueId: null,
        muted: false,
        ...overrides,
    };
}

describe('getEffectiveVolume', () => {
    beforeEach(() => {
        storeCell.value = baseState();
    });

    it('returns -6 dB when the control room store is uninitialized', () => {
        storeCell.value = null;

        expect(getEffectiveVolume()).toBe(-6);
    });

    it('returns -Infinity when monitoring is muted', () => {
        storeCell.value = baseState({ muted: true });

        expect(getEffectiveVolume()).toBe(-Infinity);
    });

    it('adds dim level when dim is active', () => {
        storeCell.value = baseState({
            dimActive: true,
            monitorVolume: -6,
            dimLevel: -12,
            monitors: [{ id: 'm1', name: 'Main', gainDb: 0, active: true, calibrationDb: 0 }],
        });

        expect(getEffectiveVolume()).toBe(-18);
    });

    it('adds calibration offset for the active monitor', () => {
        storeCell.value = baseState({
            monitorVolume: -6,
            activeMonitorId: 'm1',
        });

        expect(getEffectiveVolume()).toBe(-4.5);
    });

    it('uses no calibration when the active monitor id is missing from the list', () => {
        storeCell.value = baseState({
            monitorVolume: -6,
            activeMonitorId: 'unknown',
        });

        expect(getEffectiveVolume()).toBe(-6);
    });
});
