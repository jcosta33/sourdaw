import { describe, expect, it, vi } from 'vitest';

import { desktopInvoke, invokeForBinaryResponse } from '#/utils/desktopBridge';

import { createDesktopNativeGraphTransport, type NativeLevainBankLayout } from '../nativeGraphTransport';
import { type NativeGraphWireBatch } from '../serializeAudioGraphCommand';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn(),
    invokeForBinaryResponse: vi.fn(),
}));

const BATCH: NativeGraphWireBatch = {
    schemaVersion: 1,
    commands: [{ kind: 'set-transport', playing: true, positionSeconds: 0 }],
};

describe('createDesktopNativeGraphTransport', () => {
    it('registers material through register_timeline_sample with the trailing byte payload', async () => {
        const pcm = new Uint8Array([0, 0, 128, 63, 0, 0, 128, 63]);
        vi.mocked(desktopInvoke).mockResolvedValue({ frames: 1 });

        const result = await createDesktopNativeGraphTransport().registerTimelineSample({
            sampleId: 'take-1',
            sampleRate: 44_100,
            channels: 2,
            pcm,
        });

        expect(desktopInvoke).toHaveBeenCalledWith('register_timeline_sample', {
            sampleId: 'take-1',
            sampleRate: 44_100,
            channels: 2,
            pcm,
        });
        expect(result).toEqual({ frames: 1 });
    });

    it('opens a Levain bank through begin_levain_bank', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue({ bankKey: 'strings@1' });

        const result = await createDesktopNativeGraphTransport().beginLevainBank({
            bankKey: 'strings@1',
            instrumentId: 'strings',
        });

        expect(desktopInvoke).toHaveBeenCalledWith('begin_levain_bank', {
            bankKey: 'strings@1',
            instrumentId: 'strings',
        });
        expect(result).toEqual({ bankKey: 'strings@1' });
    });

    it('stages bank material through register_levain_sample with the trailing byte payload', async () => {
        const pcm = new Uint8Array([0, 0, 128, 63, 0, 0, 0, 0]);
        vi.mocked(desktopInvoke).mockResolvedValue({ frames: 2 });

        const result = await createDesktopNativeGraphTransport().registerLevainSample({
            bankKey: 'strings@1',
            sampleId: 'a3.wav',
            sampleRate: 44_100,
            channels: 1,
            pcm,
        });

        expect(desktopInvoke).toHaveBeenCalledWith('register_levain_sample', {
            bankKey: 'strings@1',
            sampleId: 'a3.wav',
            sampleRate: 44_100,
            channels: 1,
            pcm,
        });
        expect(result).toEqual({ frames: 2 });
    });

    it('closes a Levain bank through commit_levain_bank with its zone layout', async () => {
        const layout: NativeLevainBankLayout = {
            zones: [
                {
                    sampleId: 'a3.wav',
                    articulationId: 0,
                    rootNote: 69,
                    loKey: 0,
                    hiKey: 127,
                    loVel: 0,
                    hiVel: 127,
                    rrPos: 0,
                    rrLen: 1,
                    micId: 0,
                    isRelease: false,
                    loopMode: 'none',
                    loopStart: 0,
                    loopEnd: 0,
                    loopCrossfade: 0,
                    gainDb: 0,
                    attack: 0,
                    decay: 0,
                    sustain: 1,
                    release: 0.05,
                },
            ],
            legatoTransitions: [],
            numArticulations: 1,
            numMics: 1,
        };
        const ack = { samples: 1, zones: 1, legatoTransitions: 0, bytes: 4 };
        vi.mocked(desktopInvoke).mockResolvedValue(ack);

        const result = await createDesktopNativeGraphTransport().commitLevainBank({
            bankKey: 'strings@1',
            layout,
        });

        expect(desktopInvoke).toHaveBeenCalledWith('commit_levain_bank', { bankKey: 'strings@1', layout });
        expect(result).toBe(ack);
    });

    it('renders through render_graph_offline on the binary-response path', async () => {
        const bytes = new Uint8Array(8);
        vi.mocked(invokeForBinaryResponse).mockResolvedValue(bytes);

        const result = await createDesktopNativeGraphTransport().renderGraphOffline({
            batch: BATCH,
            frames: 1,
            sampleRate: 48_000,
        });

        expect(invokeForBinaryResponse).toHaveBeenCalledWith({
            command: 'render_graph_offline',
            args: { batch: BATCH, frames: 1, sampleRate: 48_000 },
        });
        expect(result).toBe(bytes);
    });

    it('applies live batches through apply_graph_commands', async () => {
        const applyResult = { acceptance: 'accepted', application: 'applied' };
        vi.mocked(desktopInvoke).mockResolvedValue(applyResult);

        const result = await createDesktopNativeGraphTransport().applyGraphCommands({ batch: BATCH });

        expect(desktopInvoke).toHaveBeenCalledWith('apply_graph_commands', { batch: BATCH });
        expect(result).toBe(applyResult);
    });

    it('probes through map_graph_batch with the prior beside the incoming batch', async () => {
        const mapResult = { acceptance: 'accepted', application: 'applied', reports: [] };
        vi.mocked(desktopInvoke).mockResolvedValue(mapResult);
        const prior = BATCH.commands;

        const result = await createDesktopNativeGraphTransport().mapGraphBatch({
            prior,
            batch: BATCH,
            sampleRate: 48_000,
        });

        // An absent session crosses as an explicit `null`: the seam orders
        // named arguments positionally, and the addon reads null as "no
        // session" — an `undefined` hole would deserialize the same today but
        // depends on it, so the transport states the absence.
        expect(desktopInvoke).toHaveBeenCalledWith('map_graph_batch', {
            prior,
            batch: BATCH,
            sampleRate: 48_000,
            session: null,
        });
        expect(result).toBe(mapResult);
    });

    it('carries a mapping session key through map_graph_batch when the caller resumes one', async () => {
        const mapResult = { acceptance: 'accepted', application: 'applied', reports: [] };
        vi.mocked(desktopInvoke).mockResolvedValue(mapResult);
        const session = { sessionId: 'offline-abc', revision: 3 };

        await createDesktopNativeGraphTransport().mapGraphBatch({
            prior: [],
            batch: BATCH,
            sampleRate: 48_000,
            session,
        });

        expect(desktopInvoke).toHaveBeenCalledWith('map_graph_batch', {
            prior: [],
            batch: BATCH,
            sampleRate: 48_000,
            session,
        });
    });
});
