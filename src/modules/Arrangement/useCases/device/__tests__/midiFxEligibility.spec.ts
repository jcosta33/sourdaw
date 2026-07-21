import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addMidiFx } from '../addMidiFx';
import { bypassMidiFx } from '../bypassMidiFx';
import { removeMidiFx } from '../removeMidiFx';
import { updateMidiFxParam } from '../updateMidiFxParam';

type TestMidiFx = {
    id: string;
    name: string;
    type: 'arp';
    bypassed: boolean;
    parameterValues: Record<string, number>;
};

type TestTrack = {
    kind: string;
    midiFx: TestMidiFx[];
};

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn(),
    updateTrack: vi.fn(),
    updatedTrack: null as TestTrack | null,
    addMidiFxToStrip: vi.fn(),
    updateMidiFxBypass: vi.fn(),
    updateMidiFxParam: vi.fn(),
    removeMidiFxFromStrip: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('../../updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    addMidiFxToStrip: mocks.addMidiFxToStrip,
    updateMidiFxBypass: mocks.updateMidiFxBypass,
    updateMidiFxParam: mocks.updateMidiFxParam,
    removeMidiFxFromStrip: mocks.removeMidiFxFromStrip,
}));

const residue: TestMidiFx = {
    id: 'fx-1',
    name: 'Arp',
    type: 'arp',
    bypassed: false,
    parameterValues: {},
};

describe('dormant VCA MIDI FX eligibility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.updatedTrack = null;
        mocks.getTrackById.mockReturnValue({ id: 'vca-1', kind: 'vca', midiFx: [residue] });
        mocks.updateTrack.mockImplementation((_trackId: string, updater: (track: TestTrack) => TestTrack) => {
            mocks.updatedTrack = updater({ kind: 'vca', midiFx: [residue] });
        });
    });

    it('rejects add, bypass, and parameter updates before project or engine work', () => {
        addMidiFx('vca-1', 'arp');
        bypassMidiFx('vca-1', 'fx-1', true);
        updateMidiFxParam('vca-1', 'fx-1', 'rate', 2);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.addMidiFxToStrip).not.toHaveBeenCalled();
        expect(mocks.updateMidiFxBypass).not.toHaveBeenCalled();
        expect(mocks.updateMidiFxParam).not.toHaveBeenCalled();
    });

    it('removes dormant VCA residue from project truth and engine state', () => {
        removeMidiFx('vca-1', 'fx-1');

        expect(mocks.updatedTrack).toEqual({ kind: 'vca', midiFx: [] });
        expect(mocks.removeMidiFxFromStrip).toHaveBeenCalledWith('vca-1', 'fx-1');
    });

    it('preserves the non-MIDI project no-op while still attempting engine cleanup', () => {
        mocks.updateTrack.mockImplementation((_trackId: string, updater: (track: TestTrack) => TestTrack) => {
            mocks.updatedTrack = updater({ kind: 'audio', midiFx: [residue] });
        });

        removeMidiFx('audio-1', 'fx-1');

        expect(mocks.updatedTrack).toEqual({ kind: 'audio', midiFx: [residue] });
        expect(mocks.removeMidiFxFromStrip).toHaveBeenCalledWith('audio-1', 'fx-1');
    });
});
