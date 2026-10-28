import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { createTrack } from '#/modules/Arrangement/models/Track';
import { exportCachedAudioBuffers } from '#/modules/AudioEngine/useCases';
import { captureProjectOriginalMedia } from '#/modules/Collaboration/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { CURRENT_PROJECT_VERSION, type ProjectData } from '../../../../models/ProjectData';
import { downloadProjectFile } from '../../../../repositories/project/downloadProjectFile';
import { exportProjectFile } from '../exportProjectFile';

import type { Track } from '#/modules/Arrangement/stores';
import type { ProjectDataWithOriginalMedia } from '../projectOriginalMediaArchive';

const captureExternalPluginStatesMock = vi.hoisted(() => vi.fn<() => Promise<void>>(() => Promise.resolve()));
const agentProjectRepairStateStoreMock = vi.hoisted((): { value: unknown } => ({ value: null }));
const trackStoreMock = vi.hoisted((): { value: { tracks: Track[] } } => ({ value: { tracks: [] } }));

vi.mock('../../../../repositories/project/downloadProjectFile', () => ({
    downloadProjectFile: vi.fn(() => Promise.resolve('written' as const)),
}));
vi.mock('../../../arrangement/syncCurrentArrangementToStore', () => ({ syncCurrentArrangementToStore: vi.fn() }));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        setWriters: vi.fn(),
        warn: vi.fn(),
    },
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/CrdtDocument/stores', () => ({
    agentProjectRepairStateStore: agentProjectRepairStateStoreMock,
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    captureProjectOriginalMedia: vi.fn<() => Promise<{ media: Map<string, Blob>; unavailable: string[] }>>(() => {
        throw new Error('Unexpected original media capture in this fixture');
    }),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: vi.fn(() => 'export-revision'),
}));
vi.mock('#/modules/Routing/useCases', () => ({ getAllSidechainRoutes: () => [] }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    exportCachedAudioBuffers: vi.fn().mockResolvedValue({}),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    // `subscribe` is required: loading the real Yeast stores module (via
    // buildProjectData) subscribes to the track store at import time.
    trackStore: {
        get value() {
            return trackStoreMock.value;
        },
        subscribe: () => () => undefined,
    },
    markerStore: { value: { markers: [] } },
    takeLaneStore: { value: undefined },
    adjustmentLayerStore: { value: { layers: [] } },
    vcaGroupStore: { value: { groups: [] } },
    gainEnvelopeStore: { value: { envelopes: {} } },
    warpStateStore: { value: { states: {} } },
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

function seedMissingOriginalExport(): void {
    const track = createTrack({ id: 'track', name: 'Audio', kind: 'audio' });
    track.clips.push({
        id: 'clip',
        trackId: track.id,
        name: 'Take',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        audioBufferId: 'pcm',
        assetHash: 'sha256:missing-original',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#fff',
        locked: false,
        muted: false,
    });
    trackStoreMock.value = { tracks: [track] };
    vi.mocked(exportCachedAudioBuffers).mockResolvedValue({
        pcm: { sampleRate: 48_000, numberOfChannels: 1, channelData: ['playable-pcm'] },
    });
    vi.mocked(captureProjectOriginalMedia).mockResolvedValueOnce({
        media: new Map(),
        unavailable: ['sha256:missing-original'],
    });
}

describe('exportProjectFile', () => {
    beforeEach(() => {
        agentProjectRepairStateStoreMock.value = null;
        vi.mocked(downloadProjectFile).mockClear();
        vi.mocked(logger.error).mockClear();
        vi.mocked(notifyUser).mockClear();
        vi.mocked(exportCachedAudioBuffers).mockClear();
        vi.mocked(exportCachedAudioBuffers).mockResolvedValue({});
        captureExternalPluginStatesMock.mockClear();
        trackStoreMock.value = { tracks: [] };
    });

    it('writes the current project version into the exported data', async () => {
        await exportProjectFile();

        expect(downloadProjectFile).toHaveBeenCalledTimes(1);
        const written = vi.mocked(downloadProjectFile).mock.calls[0]?.[0].data as ProjectData;
        expect(written.version).toBe(CURRENT_PROJECT_VERSION);
        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith('Project exported successfully', 'info');
    });

    it('reports unavailable originals only after writing playable PCM and its archive marker', async () => {
        seedMissingOriginalExport();

        await exportProjectFile();

        const archive = vi.mocked(downloadProjectFile).mock.calls[0]?.[0].data as ProjectDataWithOriginalMedia;
        expect(archive.audioBuffers?.pcm?.channelData).toEqual(['playable-pcm']);
        expect(archive.originalMedia).toEqual({
            format: 'sourdaw-original-media-v1',
            assets: [],
            unavailable: ['sha256:missing-original'],
        });
        expect(notifyUser).toHaveBeenCalledWith(
            'Project exported with 1 unavailable original audio file — playable audio is included, but the original source files cannot be recovered from this export.',
            'warning'
        );
        expect(notifyUser).not.toHaveBeenCalledWith('Project exported successfully', 'info');
        expect(notifyUser).not.toHaveBeenCalledWith(expect.stringContaining('could not be bundled'), 'warning');
    });

    it('does not report unavailable originals when that export is cancelled', async () => {
        seedMissingOriginalExport();
        vi.mocked(downloadProjectFile).mockResolvedValueOnce('cancelled');

        await exportProjectFile();

        expect(downloadProjectFile).toHaveBeenCalledTimes(1);
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('reports both missing PCM and originals without claiming playable audio was included', async () => {
        seedMissingOriginalExport();
        vi.mocked(exportCachedAudioBuffers).mockResolvedValueOnce({});

        await exportProjectFile();

        expect(downloadProjectFile).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith(
            '1 audio file could not be bundled with the export — the project may not play back correctly on another machine.',
            'warning'
        );
        expect(notifyUser).toHaveBeenCalledWith(
            'Project exported with 1 unavailable original audio file — the original source files cannot be recovered from this export.',
            'warning'
        );
        expect(notifyUser).not.toHaveBeenCalledWith('Project exported successfully', 'info');
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

    it('does not download a project snapshot while raw CRDT project repair is required', async () => {
        agentProjectRepairStateStoreMock.value = {
            audioGraphValid: true,
            detectedRevision: 'revision-with-invalid-adjustment-layers',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [
                {
                    kind: 'repair-project-invariants',
                    targetIds: ['@project/raw/adjustmentLayers'],
                },
            ],
            status: 'repair-required',
        };

        await exportProjectFile();

        expect(downloadProjectFile).not.toHaveBeenCalled();
        expect(exportCachedAudioBuffers).not.toHaveBeenCalled();
    });

    it('does not download when CRDT repair becomes required during audio export', async () => {
        let resolveAudioExport!: (buffers: Record<string, never>) => void;
        vi.mocked(exportCachedAudioBuffers).mockReturnValue(
            new Promise<Record<string, never>>((resolve) => {
                resolveAudioExport = resolve;
            })
        );

        const exportPromise = exportProjectFile();
        await vi.waitFor(() => {
            expect(exportCachedAudioBuffers).toHaveBeenCalledTimes(1);
        });
        agentProjectRepairStateStoreMock.value = {
            audioGraphValid: true,
            detectedRevision: 'repair-entered-during-audio-export',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [
                {
                    kind: 'repair-project-invariants',
                    targetIds: ['@project/raw/adjustmentLayers'],
                },
            ],
            status: 'repair-required',
        };
        resolveAudioExport({});

        await exportPromise;

        expect(downloadProjectFile).not.toHaveBeenCalled();
    });

    it('passes a live repair-state authority predicate to the download boundary', async () => {
        let suppliedShouldWrite: (() => boolean) | undefined;
        vi.mocked(downloadProjectFile).mockImplementationOnce(({ shouldWrite }) => {
            suppliedShouldWrite = shouldWrite;
            agentProjectRepairStateStoreMock.value = {
                audioGraphValid: true,
                detectedRevision: 'repair-entered-before-download-write',
                inspectionAvailable: true,
                projectInvariantsValid: false,
                rawProjectRetained: true,
                repairCandidates: [
                    {
                        kind: 'repair-project-invariants',
                        targetIds: ['@project/raw/adjustmentLayers'],
                    },
                ],
                status: 'repair-required',
            };
            return Promise.resolve(shouldWrite() ? 'written' : 'rejected-stale');
        });

        await exportProjectFile();

        expect(suppliedShouldWrite).toEqual(expect.any(Function));
        expect(suppliedShouldWrite?.()).toBe(false);
        expect(notifyUser).not.toHaveBeenCalledWith('Project exported successfully', 'info');
    });

    it.each(['cancelled', 'rejected-stale'] as const)(
        'does not announce success when download is %s',
        async (outcome) => {
            vi.mocked(downloadProjectFile).mockResolvedValueOnce(outcome);

            await exportProjectFile();

            expect(notifyUser).not.toHaveBeenCalledWith('Project exported successfully', 'info');
        }
    );

    it('reports a failed project-file download without rejecting the export action', async () => {
        const failure = new Error('save dialog failed');
        vi.mocked(downloadProjectFile).mockRejectedValueOnce(failure);

        await expect(exportProjectFile()).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledTimes(1);
        const loggedError = vi.mocked(logger.error).mock.calls[0]?.[0];
        expect(loggedError).toBeInstanceOf(Error);
        expect(loggedError).toMatchObject({ message: 'Project export failed', cause: failure });
        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith('Failed to export project', 'error');
        expect(notifyUser).not.toHaveBeenCalledWith('Project exported successfully', 'info');
    });
});
