import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mockValue;
        },
    },
}));

vi.mock('../../models/CrumbsDeviceState', () => ({
    fromCrumbsDeviceState: vi.fn(),
}));

import { fromCrumbsDeviceState } from '../../models/CrumbsDeviceState';
import { hydrateCrumbsStateFromProject } from '../hydrateCrumbsStateFromProject';

const mockedFromDeviceState = vi.mocked(fromCrumbsDeviceState);

let mockValue: { tracks: Array<{ devices: Array<{ id: string; deviceState: unknown }> }> } | null = null;

beforeEach(() => {
    vi.clearAllMocks();
    mockValue = null;
});

describe('hydrateCrumbsStateFromProject', () => {
    it('returns null when trackStore is null', () => {
        mockValue = null;
        expect(hydrateCrumbsStateFromProject('d1')).toBeNull();
    });

    it('returns null when device not found', () => {
        mockValue = { tracks: [{ devices: [{ id: 'other', deviceState: {} }] }] };
        expect(hydrateCrumbsStateFromProject('d1')).toBeNull();
    });

    it('returns null when fromCrumbsDeviceState returns null', () => {
        mockValue = { tracks: [{ devices: [{ id: 'd1', deviceState: {} }] }] };
        mockedFromDeviceState.mockReturnValue(null);
        expect(hydrateCrumbsStateFromProject('d1')).toBeNull();
    });

    it('returns hydrated state with mode and activeSample', () => {
        mockValue = { tracks: [{ devices: [{ id: 'd1', deviceState: {} }] }] };
        mockedFromDeviceState.mockReturnValue({
            mode: 'slice',
            activeSample: { detectedRoot: 60 },
        } as never);
        const result = hydrateCrumbsStateFromProject('d1');
        expect(result).not.toBeNull();
        expect(result!.mode).toBe('slice');
        expect(result!.rootNote).toBe(60);
    });

    it('uses default rootNote when activeSample has no detectedRoot', () => {
        mockValue = { tracks: [{ devices: [{ id: 'd1', deviceState: {} }] }] };
        mockedFromDeviceState.mockReturnValue({
            mode: 'drum',
            activeSample: null,
        } as never);
        const result = hydrateCrumbsStateFromProject('d1');
        expect(result!.rootNote).toBe(60); // defaultCrumbsState.rootNote
    });
});
