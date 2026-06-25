import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CURRENT_PROJECT_VERSION, type ProjectData } from '../../../../models/ProjectData';
import { downloadProjectFile } from '../../../../repositories/project/downloadProjectFile';
import { exportProjectFile } from '../exportProjectFile';

vi.mock('../../../../repositories/project/downloadProjectFile', () => ({
    downloadProjectFile: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../../arrangement/helpers', () => ({ syncCurrentArrangementToStore: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/Routing/useCases', () => ({ getAllSidechainRoutes: () => [] }));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { tracks: [] } },
    markerStore: { value: { markers: [] } },
    takeLaneStore: { value: undefined },
    adjustmentLayerStore: { value: { layers: [] } },
}));
vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { exportBuffers: vi.fn().mockResolvedValue({}) },
}));
vi.mock('#/modules/Automation/stores', () => ({ automationStore: { value: { lanes: [] } } }));
vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: { value: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} } },
}));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: { tempo: 120 } },
    tempoMapStore: { value: undefined },
    timeSignatureMapStore: { value: undefined },
}));
vi.mock('../../../../stores/arrangementStore', () => ({
    arrangementStore: { value: { arrangements: [], activeArrangementId: 'a' } },
}));
vi.mock('../../../../stores/projectStore', () => ({
    projectStore: {
        value: {
            name: 'P',
            createdAt: 1,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
    },
}));

describe('exportProjectFile', () => {
    beforeEach(() => {
        vi.mocked(downloadProjectFile).mockClear();
    });

    it('writes the current project version into the exported data', async () => {
        await exportProjectFile();

        expect(downloadProjectFile).toHaveBeenCalledTimes(1);
        const written = vi.mocked(downloadProjectFile).mock.calls[0]?.[0] as ProjectData;
        expect(written.version).toBe(CURRENT_PROJECT_VERSION);
    });
});
