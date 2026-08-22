import { describe, it, expect, vi, beforeEach } from 'vitest';

import { exportCachedAudioBuffers } from '#/modules/AudioEngine/useCases';

import { CURRENT_PROJECT_VERSION, type ProjectData } from '../../../../models/ProjectData';
import { downloadProjectFile } from '../../../../repositories/project/downloadProjectFile';
import { exportProjectFile } from '../exportProjectFile';

const captureExternalPluginStatesMock = vi.hoisted(() => vi.fn<() => Promise<void>>(() => Promise.resolve()));

vi.mock('../../../../repositories/project/downloadProjectFile', () => ({
    downloadProjectFile: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../../arrangement/syncCurrentArrangementToStore', () => ({ syncCurrentArrangementToStore: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/Routing/useCases', () => ({ getAllSidechainRoutes: () => [] }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    exportCachedAudioBuffers: vi.fn().mockResolvedValue({}),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    // `subscribe` is required: loading the real Yeast stores module (via
    // buildProjectData) subscribes to the track store at import time.
    trackStore: { value: { tracks: [] }, subscribe: () => () => undefined },
    markerStore: { value: { markers: [] } },
    takeLaneStore: { value: undefined },
    adjustmentLayerStore: { value: { layers: [] } },
    vcaGroupStore: { value: { groups: [] } },
    gainEnvelopeStore: { value: { envelopes: {} } },
}));
vi.mock('#/modules/Automation/stores', () => ({
    automationStore: { value: { lanes: [] } },
    modulationStore: { value: { modulators: [] } },
}));
vi.mock('#/modules/CvGate/stores', () => ({ cvGateStore: { value: undefined } }));
vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
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
            // buildProjectData refuses to serialize without a canonical
            // project id; this fixture predates that guard.
            projectId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
            name: 'P',
            createdAt: 1,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
    },
}));
vi.mock('../../saveProject/captureExternalPluginStates', () => ({
    captureExternalPluginStates: captureExternalPluginStatesMock,
}));

describe('exportProjectFile', () => {
    beforeEach(() => {
        vi.mocked(downloadProjectFile).mockClear();
        vi.mocked(exportCachedAudioBuffers).mockClear();
        vi.mocked(exportCachedAudioBuffers).mockResolvedValue({});
        captureExternalPluginStatesMock.mockClear();
    });

    it('writes the current project version into the exported data', async () => {
        await exportProjectFile();

        expect(downloadProjectFile).toHaveBeenCalledTimes(1);
        const written = vi.mocked(downloadProjectFile).mock.calls[0]?.[0] as ProjectData;
        expect(written.version).toBe(CURRENT_PROJECT_VERSION);
    });

    it('captures live native plugin state before building the export (no prior save required)', async () => {
        await exportProjectFile();

        expect(captureExternalPluginStatesMock).toHaveBeenCalledTimes(1);
        // Capture must run before the snapshot is downloaded, so an export with no
        // prior save still ships the current host chunk rather than a stale one.
        const captureOrder = captureExternalPluginStatesMock.mock.invocationCallOrder[0]!;
        const downloadOrder = vi.mocked(downloadProjectFile).mock.invocationCallOrder[0]!;
        expect(captureOrder).toBeLessThan(downloadOrder);
    });
});
