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

describe('MIDI-track MIDI FX operations', () => {
    const midiTrack = { id: 'midi-1', kind: 'midi', midiFx: [residue] };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.updatedTrack = null;
        mocks.getTrackById.mockReturnValue(midiTrack);
    });

    it('addMidiFx appends a new fx to a midi track and notifies the engine', () => {
        mocks.updateTrack.mockImplementation((_trackId: string, updater: (track: TestTrack) => TestTrack) => {
            mocks.updatedTrack = updater({ kind: 'midi', midiFx: [residue] });
        });

        addMidiFx('midi-1', 'velocity', 'Vel');

        expect(mocks.updatedTrack?.midiFx).toHaveLength(2);
        const added = mocks.updatedTrack?.midiFx[1];
        expect(added).toMatchObject({ name: 'Vel', type: 'velocity', bypassed: false });
        expect(mocks.addMidiFxToStrip).toHaveBeenCalledWith('midi-1', expect.any(String), 'velocity');
    });

    it('addMidiFx defaults the fx name to the uppercased type when none is given', () => {
        mocks.updateTrack.mockImplementation((_trackId: string, updater: (track: TestTrack) => TestTrack) => {
            mocks.updatedTrack = updater({ kind: 'midi', midiFx: [] });
        });

        addMidiFx('midi-1', 'arp');

        expect(mocks.updatedTrack?.midiFx[0]?.name).toBe('ARP');
    });

    it('bypassMidiFx flips the bypassed flag on the matched fx and syncs the engine', () => {
        mocks.updateTrack.mockImplementation((_trackId: string, updater: (track: TestTrack) => TestTrack) => {
            mocks.updatedTrack = updater({ kind: 'midi', midiFx: [residue] });
        });

        bypassMidiFx('midi-1', 'fx-1', true);

        expect(mocks.updatedTrack?.midiFx[0]?.bypassed).toBe(true);
        expect(mocks.updateMidiFxBypass).toHaveBeenCalledWith('midi-1', 'fx-1', true);
    });

    it('updateMidiFxParam sets the parameter on the matched fx and syncs the engine', () => {
        mocks.updateTrack.mockImplementation((_trackId: string, updater: (track: TestTrack) => TestTrack) => {
            mocks.updatedTrack = updater({ kind: 'midi', midiFx: [residue] });
        });

        updateMidiFxParam('midi-1', 'fx-1', 'rate', 4);

        expect(mocks.updatedTrack?.midiFx[0]?.parameterValues).toEqual({ rate: 4 });
        expect(mocks.updateMidiFxParam).toHaveBeenCalledWith('midi-1', 'fx-1', 'rate', 4);
    });

    it('continues when the engine throws (logged, project truth still updated)', () => {
        mocks.addMidiFxToStrip.mockImplementation(() => {
            throw new Error('engine down');
        });
        mocks.updateTrack.mockImplementation((_trackId: string, updater: (track: TestTrack) => TestTrack) => {
            mocks.updatedTrack = updater({ kind: 'midi', midiFx: [] });
        });

        // must not rethrow — failure is logged but the project write stands
        expect(() => addMidiFx('midi-1', 'arp')).not.toThrow();
        expect(mocks.updatedTrack?.midiFx).toHaveLength(1);
    });

    it('rejects the operation when the track cannot be found', () => {
        mocks.getTrackById.mockReturnValue(null);

        addMidiFx('missing', 'arp');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.addMidiFxToStrip).not.toHaveBeenCalled();
    });
});
