import { describe, expect, it, vi } from 'vitest';

import { desktopInvoke, invokeForBinaryResponse } from '#/utils/desktopBridge';

import { createDesktopNativeGraphTransport } from '../nativeGraphTransport';
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
