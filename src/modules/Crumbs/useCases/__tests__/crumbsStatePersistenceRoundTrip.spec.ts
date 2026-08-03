import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTrackState, sanitizeTrackSnapshot, trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';

import { crumbsStore, setActiveSample, setMode } from '../../stores/crumbsStore';
import { ensureCrumbsInstanceFromProject } from '../crumbsLifecycle/ensureCrumbsInstanceFromProject';
import { initCrumbsDeviceStatePersistence } from '../initCrumbsDeviceStatePersistence';
import { prepareCrumbsEngine } from '../prepareCrumbsEngine';

import type { SampleMeta } from '../../models/CrumbsTypes';

const { decodeMock } = vi.hoisted(() => ({
    decodeMock: vi.fn(),
}));

vi.mock('../../repositories/sampleTransfer/decodeCrumbsSampleFile', () => ({
    decodeCrumbsSampleFile: decodeMock,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const DEVICE_ID = 'crumbs-1';

function sampleMeta(): SampleMeta {
    return {
        sampleId: 3,
        sampleRate: 48_000,
        channels: 2,
        frameCount: 4,
        durationSecs: 4 / 48_000,
        detectedRoot: 62,
        detectedBpm: null,
        category: 'loop',
        filePath: '/samples/break.wav',
        fileName: 'break.wav',
    };
}

function recordingPort(): { port: MessagePort; posts: Array<Record<string, unknown>> } {
    const posts: Array<Record<string, unknown>> = [];
    const port = {
        postMessage: (message: Record<string, unknown>) => {
            posts.push(message);
        },
    } as unknown as MessagePort;
    return { port, posts };
}

function makeCrumbsTracks(deviceState?: Track['devices'][number]['deviceState']): Track[] {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Breaks',
                kind: 'midi',
                devices: [
                    {
                        id: DEVICE_ID,
                        name: 'Crumbs',
                        type: 'builtin-crumbs',
                        bypassed: false,
                        parameterValues: {},
                        deviceState,
                    },
                ],
            },
        ],
        selectedTrackId: null,
    }).tracks;
}

/**
 * Crumbs' knobs are numbers and already ride `Device.parameterValues`. The sample
 * it plays is a file reference and its operating mode is a string, and neither
 * reached project truth at all — so a reopened project's Crumbs tracks were silent,
 * live and in a bounce, with no error and no prompt to relocate the file.
 *
 * `sanitizeTrackSnapshot` is the projection both the CRDT hydrate and the file
 * import run through, so a field it does not carry is a field that does not survive
 * a reload.
 */
describe('Crumbs state persistence round trip', () => {
    let stopPersistence: () => void;

    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        crumbsStore.set({});
        trackStore.set({ ...defaultTrackState, tracks: makeCrumbsTracks() });
        stopPersistence = initCrumbsDeviceStatePersistence();
    });

    afterEach(() => {
        stopPersistence();
    });

    it('carries the loaded sample and mode through a reload, into playback and the export', async () => {
        ensureCrumbsInstanceFromProject(DEVICE_ID);
        await Promise.resolve();

        // The sample loader and the mode switch write exactly these.
        setActiveSample(DEVICE_ID, sampleMeta());
        setMode(DEVICE_ID, 'slice');
        await Promise.resolve();
        await Promise.resolve();

        // Reload: project the document, then rebuild the session from it alone.
        const projected = sanitizeTrackSnapshot(trackStore.value);
        trackStore.set({ ...defaultTrackState, tracks: projected.tracks });
        crumbsStore.set({});

        const data = new Float32Array([0.1, -0.1]);
        decodeMock.mockResolvedValue({ data, frameCount: 1, channels: 2, sampleRate: 44_100 });
        const { port, posts } = recordingPort();

        await prepareCrumbsEngine({ deviceId: DEVICE_ID, port });

        expect(decodeMock).toHaveBeenCalledWith({ filePath: '/samples/break.wav' });
        expect(posts).toEqual([
            { type: 'mode', mode: 'slice' },
            { type: 'loadSample', data, channels: 2, sampleRate: 44_100 },
        ]);

        // The panel reads the session store, so the restored sample has to reach it
        // too — a sample the engine plays but the waveform does not name is still a
        // project the user cannot edit.
        ensureCrumbsInstanceFromProject(DEVICE_ID);
        expect(crumbsStore.value?.[DEVICE_ID]?.activeSample?.fileName).toBe('break.wav');
        expect(crumbsStore.value?.[DEVICE_ID]?.mode).toBe('slice');
        expect(crumbsStore.value?.[DEVICE_ID]?.rootNote).toBe(62);
    });

    it('loads the sample and mode project truth holds after a reload wiped the session store', async () => {
        // The reader alone, against a chunk the document already carries.
        trackStore.set({
            ...defaultTrackState,
            tracks: makeCrumbsTracks({
                version: 1,
                data: { mode: 'slice', activeSample: { ...sampleMeta() } },
            }),
        });
        crumbsStore.set({});
        const data = new Float32Array([0.1, -0.1]);
        decodeMock.mockResolvedValue({ data, frameCount: 1, channels: 2, sampleRate: 44_100 });
        const { port, posts } = recordingPort();

        await prepareCrumbsEngine({ deviceId: DEVICE_ID, port });

        expect(decodeMock).toHaveBeenCalledWith({ filePath: '/samples/break.wav' });
        expect(posts).toEqual([
            { type: 'mode', mode: 'slice' },
            { type: 'loadSample', data, channels: 2, sampleRate: 44_100 },
        ]);
    });

    it('posts nothing for a device neither the session nor project truth knows', async () => {
        // Presence pin: the silent path must stay reachable, or the assertions above
        // would also pass for a reader that posts a hard-coded sample.
        const { port, posts } = recordingPort();

        await prepareCrumbsEngine({ deviceId: 'never-created', port });

        expect(posts).toEqual([]);
        expect(decodeMock).not.toHaveBeenCalled();
    });

    it('does not write a chunk for a device that only appeared', async () => {
        ensureCrumbsInstanceFromProject(DEVICE_ID);
        await Promise.resolve();
        await Promise.resolve();

        expect(trackStore.value?.tracks[0]?.devices[0]?.deviceState).toBeUndefined();
    });
});
