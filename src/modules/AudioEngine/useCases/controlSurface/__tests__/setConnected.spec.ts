import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type ControlSurfaceState } from '../../../stores/controlSurface';
import { setConnected } from '../setConnected';

const mocks = vi.hoisted(() => ({
    state: null as ControlSurfaceState | null,
    set: vi.fn(),
}));

vi.mock('../../../stores/controlSurface', () => ({
    controlSurfaceStore: {
        get value() {
            return mocks.state;
        },
        set: mocks.set,
    },
}));

const minimalState = (): ControlSurfaceState => ({
    protocol: 'mcu',
    mcu: {
        faders: [],
        bankOffset: 0,
        vpots: [],
        mode: 'pan',
        timecodeDisplay: '',
        assignmentDisplay: '',
    },
    oscEndpoints: [],
    oscMappings: [],
    connected: false,
});

describe('setConnected', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = minimalState();
    });

    it('should not write when the control surface store is null', () => {
        mocks.state = null;

        setConnected(true);

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('should update the connected flag', () => {
        setConnected(true);

        expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ connected: true }));
    });
});
