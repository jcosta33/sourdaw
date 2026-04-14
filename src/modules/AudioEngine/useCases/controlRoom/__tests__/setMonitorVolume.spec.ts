import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setMonitorVolume } from '../setMonitorVolume';

const mocks = vi.hoisted(() => ({
    state: {
        monitors: [],
        activeMonitorId: 'm1',
        monitorVolume: -6,
        dimLevel: -20,
        dimActive: false,
        monoActive: false,
        referenceActive: false,
        talkbackActive: false,
        talkbackLevel: -12,
        cueMixes: [],
        activeCueId: null,
        muted: false,
    } as any,
    set: vi.fn(),
}));

vi.mock('../../../stores/controlRoom', () => ({
    controlRoomStore: {
        get value() {
            return mocks.state;
        },
        set: mocks.set,
    },
}));

const defaultState = () => ({
    monitors: [],
    activeMonitorId: 'm1',
    monitorVolume: -6,
    dimLevel: -20,
    dimActive: false,
    monoActive: false,
    referenceActive: false,
    talkbackActive: false,
    talkbackLevel: -12,
    cueMixes: [],
    activeCueId: null,
    muted: false,
});

describe('setMonitorVolume', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = defaultState();
    });

    it('should not write when the control room store is null', () => {
        mocks.state = null;

        setMonitorVolume(0);

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('should clamp monitor volume between -60 and 6 dB', () => {
        setMonitorVolume(100);

        expect(mocks.set).toHaveBeenCalledWith(
            expect.objectContaining({
                monitorVolume: 6,
            })
        );
    });
});
