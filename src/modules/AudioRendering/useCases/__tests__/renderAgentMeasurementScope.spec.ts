import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { cancelExport, checkCancel, resetCancelFlag } from '#/modules/AudioEngine/useCases';
import { sidechainStore } from '#/modules/Routing/stores';

import { renderAgentMeasurementScope } from '../renderAgentMeasurementScope';

type Track = ReturnType<typeof createTrack>;

const engine = vi.hoisted(() => ({
    renderOffline: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    isExportActive: vi.fn(),
}));
const crdt = vi.hoisted(() => ({ projectRevisionMatchesLiveIgnoringCommandCheckpoint: vi.fn() }));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    renderOffline: engine.renderOffline,
    renderTrackSubgraphOffline: engine.renderTrackSubgraphOffline,
    isExportActive: engine.isExportActive,
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    projectRevisionMatchesLiveIgnoringCommandCheckpoint: crdt.projectRevisionMatchesLiveIgnoringCommandCheckpoint,
}));

function track(id: string, kind: Track['kind'], overrides: Partial<Track> = {}): Track {
    return { ...createTrack({ id, name: id, kind }), ...overrides };
}

function fakeBuffer(frameCount = 4): AudioBuffer {
    const channel = new Float32Array(frameCount);
    return {
        sampleRate: 48_000,
        length: frameCount,
        numberOfChannels: 1,
        duration: frameCount / 48_000,
        getChannelData: () => channel,
    } as unknown as AudioBuffer;
}

beforeEach(() => {
    engine.renderOffline.mockReset().mockResolvedValue(fakeBuffer());
    engine.renderTrackSubgraphOffline.mockReset().mockResolvedValue(fakeBuffer());
    engine.isExportActive.mockReset().mockReturnValue(false);
    crdt.projectRevisionMatchesLiveIgnoringCommandCheckpoint.mockReset().mockReturnValue(true);
    sidechainStore.set({ routes: [] });
    trackStore.set({
        tracks: [track('master', 'master'), track('track-1', 'audio'), track('up-1', 'audio', { outputId: 'track-1' })],
        selectedTrackId: null,
        ghostClips: [],
    });
});

afterEach(() => {
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    // The export cancel flag is a process-wide singleton shared with every other
    // spec file; a row that leaves it raised would otherwise fail unrelated
    // freeze/bounce specs that happen to run after this file.
    resetCancelFlag();
});

describe('renderAgentMeasurementScope — export cancel flag', () => {
    it('lowers the cancel flag its own abort raised, once the master render settles', async () => {
        const controller = new AbortController();
        engine.renderOffline.mockImplementation(
            () =>
                new Promise((_resolve, reject) => {
                    controller.signal.addEventListener('abort', () => reject(new Error('Export cancelled')));
                })
        );

        const resultPromise = renderAgentMeasurementScope({
            scope: { kind: 'master' },
            startBeat: 0,
            endBeat: 4,
            sourceRevision: 'rev-1',
            signal: controller.signal,
        });
        controller.abort();
        const result = await resultPromise;

        expect(result).toEqual({ status: 'cancelled' });
        // A flag this render's own abort raised must be lowered before the render
        // reports its outcome, or the next freeze/bounce reads it and fails.
        expect(() => checkCancel()).not.toThrow();
    });

    it('leaves a cancel flag it did not raise untouched', async () => {
        // Simulates an unrelated export already having raised the process-wide
        // flag before this measurement's master render begins.
        cancelExport();

        try {
            const result = await renderAgentMeasurementScope({
                scope: { kind: 'master' },
                startBeat: 0,
                endBeat: 4,
                sourceRevision: 'rev-1',
            });

            expect(result.status).toBe('rendered');
            // This measurement's own render never raised the flag, so it must not
            // silently clear an unrelated export's cancellation.
            expect(() => checkCancel()).toThrow('Export cancelled');
        } finally {
            resetCancelFlag();
        }
    });

    it('cancels an isolated track render without touching the process-wide cancel flag', async () => {
        const controller = new AbortController();
        engine.renderTrackSubgraphOffline.mockImplementation(
            ({ abortSignal }: { abortSignal?: AbortSignal }) =>
                new Promise((_resolve, reject) => {
                    abortSignal?.addEventListener('abort', () => reject(new Error('Render aborted')));
                })
        );

        const resultPromise = renderAgentMeasurementScope({
            scope: { kind: 'tracks', ids: ['track-1'] },
            startBeat: 0,
            endBeat: 4,
            sourceRevision: 'rev-1',
            signal: controller.signal,
        });
        controller.abort();
        const result = await resultPromise;

        expect(result).toEqual({ status: 'cancelled' });
        expect(engine.renderOffline).not.toHaveBeenCalled();
        // The isolated-subgraph route never touches the process-wide export
        // cancellation state, so nothing here should require a reset.
        expect(() => checkCancel()).not.toThrow();
    });
});
