import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack, type Track } from '../../../models/Track';
import { reorderDevicesInProject } from '../reorderDevices';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

describe('reorderDevicesInProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('retains repository-current non-device fields when applying a planned chain', () => {
        const current = createTrack({ id: 'audio-1', kind: 'audio', name: 'Current name' });
        current.gain = 0.75;
        current.notes = 'newly edited note';
        current.devices = [
            { id: 'device-1', name: 'Compressor', type: 'builtin-compressor', bypassed: false, parameterValues: {} },
            { id: 'device-2', name: 'EQ', type: 'builtin-eq', bypassed: false, parameterValues: { frequency: 1000 } },
        ];
        const repositoryCurrent = structuredClone(current);
        const devices = [current.devices[1]!, current.devices[0]!];
        let written: Track | undefined;
        mocks.updateTrack.mockImplementation((_trackId: string, updater: (track: Track) => Track) => {
            written = updater(current);
        });

        reorderDevicesInProject(current.id, devices);

        expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
        expect(mocks.updateTrack).toHaveBeenCalledWith(current.id, expect.any(Function));
        expect(written).toEqual({ ...repositoryCurrent, devices });
        expect(written?.devices).toEqual(devices);
        expect(written).toMatchObject({
            id: repositoryCurrent.id,
            name: repositoryCurrent.name,
            gain: repositoryCurrent.gain,
            notes: repositoryCurrent.notes,
        });
        expect(current).toEqual(repositoryCurrent);
    });
});
