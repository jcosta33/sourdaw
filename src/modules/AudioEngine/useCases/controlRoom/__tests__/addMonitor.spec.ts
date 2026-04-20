import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ControlRoomState } from '../../../stores/controlRoom';
import { addMonitor } from '../addMonitor';

const { storeCell, applySet } = vi.hoisted(() => {
    const storeCell = { state: null as ControlRoomState | null };
    const applySet = vi.fn((next: ControlRoomState) => {
        storeCell.state = next;
    });
    return { storeCell, applySet };
});

vi.mock('../../../stores/controlRoom', () => ({
    controlRoomStore: {
        get value() {
            return storeCell.state;
        },
        set: applySet,
    },
    getNextMonitorId: vi.fn(() => 'mon-new'),
}));

function seedState(): ControlRoomState {
    return {
        monitors: [{ id: 'm-existing', name: 'Main', gainDb: 0, active: true, calibrationDb: 0 }],
        activeMonitorId: 'm-existing',
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
    };
}

describe('addMonitor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        storeCell.state = seedState();
    });

    it('does nothing when the control room store has no snapshot', () => {
        storeCell.state = null;

        addMonitor('Headphones');

        expect(applySet).not.toHaveBeenCalled();
    });

    it('appends a new monitor with a fresh id and default gains', () => {
        addMonitor('Headphones');

        expect(applySet).toHaveBeenCalledTimes(1);
        expect(storeCell.state!.monitors).toHaveLength(2);
        expect(storeCell.state!.monitors[1]).toEqual({
            id: 'mon-new',
            name: 'Headphones',
            gainDb: 0,
            active: false,
            calibrationDb: 0,
        });
    });
});
