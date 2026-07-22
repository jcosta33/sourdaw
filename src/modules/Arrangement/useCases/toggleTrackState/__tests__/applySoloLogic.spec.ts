import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { applySoloLogic } from '../applySoloLogic';

import type { ApplySoloLogicInput, ApplySoloLogicOutput } from '../../../services/applySoloLogic';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    calculateSoloLogic: vi.fn(),
    workspaceStore: { value: null as { soloMode: 'sip' | 'afl' | 'pfl' } | null },
}));

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    setTrackGain: mocks.setTrackGain,
    setTrackMute: mocks.setTrackMute,
}));

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: mocks.workspaceStore,
}));

vi.mock('../../../services/applySoloLogic', () => ({
    applySoloLogic: mocks.calculateSoloLogic,
}));

describe('applySoloLogic use case', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.workspaceStore.value = { soloMode: 'pfl' };
    });

    it('reads Arrangement and Workspace state, applies the calculation, and persists saved gains', () => {
        const track = TrackDummy.create({ id: 't1', gain: 0.5, soloed: true });
        const state = { tracks: [track], selectedTrackId: null };
        const firstResult: ApplySoloLogicOutput = {
            actions: [
                { type: 'setGain', trackId: 't1', gain: 1 },
                { type: 'setMute', trackId: 't1', muted: false },
            ],
            savedGains: new Map([['t1', 0.5]]),
        };
        const secondResult: ApplySoloLogicOutput = {
            actions: [{ type: 'setGain', trackId: 't1', gain: 0.5 }],
            savedGains: new Map(),
        };
        mocks.getTrackStoreState.mockReturnValue(state);
        mocks.calculateSoloLogic.mockReturnValueOnce(firstResult).mockReturnValueOnce(secondResult);

        applySoloLogic();
        applySoloLogic();

        expect(mocks.calculateSoloLogic).toHaveBeenNthCalledWith(1, {
            tracks: state.tracks,
            soloMode: 'pfl',
            savedGains: new Map(),
            liveStripTrackIds: new Set(['t1']),
        } satisfies ApplySoloLogicInput);
        expect(mocks.calculateSoloLogic).toHaveBeenNthCalledWith(2, {
            tracks: state.tracks,
            soloMode: 'pfl',
            savedGains: new Map([['t1', 0.5]]),
            liveStripTrackIds: new Set(['t1']),
        } satisfies ApplySoloLogicInput);
        expect(mocks.setTrackGain).toHaveBeenNthCalledWith(1, 't1', 1);
        expect(mocks.setTrackMute).toHaveBeenNthCalledWith(1, 't1', false);
        expect(mocks.setTrackGain).toHaveBeenNthCalledWith(2, 't1', 0.5);
    });

    it('does not calculate or write when Arrangement state is unavailable', () => {
        mocks.getTrackStoreState.mockReturnValue(null);

        applySoloLogic();

        expect(mocks.calculateSoloLogic).not.toHaveBeenCalled();
        expect(mocks.setTrackGain).not.toHaveBeenCalled();
        expect(mocks.setTrackMute).not.toHaveBeenCalled();
    });

    it('passes only live-strip track ids into the solo calculation', () => {
        const audio = TrackDummy.create({ id: 'audio-1' });
        const ordinaryFolder = TrackDummy.create({ id: 'folder-1', kind: 'folder' });
        const toasterFolder = TrackDummy.create({
            id: 'toaster-1',
            kind: 'folder',
            devices: [{ id: 'toaster-device', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} }],
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [audio, ordinaryFolder, toasterFolder],
            selectedTrackId: null,
        });
        mocks.calculateSoloLogic.mockReturnValue({ actions: [], savedGains: new Map() });

        applySoloLogic();

        expect(mocks.calculateSoloLogic).toHaveBeenCalledWith(
            expect.objectContaining({ liveStripTrackIds: new Set(['audio-1', 'toaster-1']) })
        );
    });
});
