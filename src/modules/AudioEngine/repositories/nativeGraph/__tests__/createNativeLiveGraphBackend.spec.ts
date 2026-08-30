/**
 * The live backend's one job: read `apply_graph_commands` and invent nothing.
 *
 * The command answers three outcomes and no others, and each one means
 * something different to a caller deciding whether the native engine took the
 * session. The cases below pin every one of them, plus the two shapes that are
 * *not* outcomes — a transport failure, which is a refusal, and a malformed
 * answer, which is a seam defect and must throw rather than pass as a result a
 * caller would act on.
 */

import { describe, expect, it, vi } from 'vitest';

import { type AudioGraphCommandBatch } from '../../../models/AudioGraphBackend';
import { createNativeLiveGraphBackend } from '../createNativeLiveGraphBackend';
import { type NativeGraphTransport } from '../nativeGraphTransport';

const BATCH: AudioGraphCommandBatch = {
    schemaVersion: 1,
    commands: [
        {
            kind: 'create-track-strip',
            trackId: 'audio-1',
            name: 'Track 1',
            state: { gain: 0.8, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 },
            devices: [],
            honorMuted: true,
            contributesAudio: false,
        },
        { kind: 'set-transport', playing: true, positionSeconds: 0 },
    ],
};

/**
 * Every method rejects except `applyGraphCommands`: the live backend must reach
 * the engine through that one command, so a backend that started probing or
 * registering material would fail here rather than pass on a permissive stub.
 */
function stubTransport(applyGraphCommands: NativeGraphTransport['applyGraphCommands']): NativeGraphTransport {
    const unexpected = (name: string) => () => Promise.reject(new Error(`the live backend must not call ${name}`));
    return {
        applyGraphCommands,
        registerTimelineSample: unexpected('register_timeline_sample'),
        renderGraphOffline: unexpected('render_graph_offline'),
        mapGraphBatch: unexpected('map_graph_batch'),
    };
}

describe('createNativeLiveGraphBackend', () => {
    it('applies the serialized batch through apply_graph_commands', async () => {
        const applyGraphCommands = vi.fn().mockResolvedValue({
            acceptance: 'accepted',
            application: 'applied',
            runtimeRevision: 1,
            reports: [],
        });

        await createNativeLiveGraphBackend({ transport: stubTransport(applyGraphCommands) }).apply(BATCH);

        expect(applyGraphCommands).toHaveBeenCalledWith({
            batch: {
                schemaVersion: 1,
                commands: [
                    {
                        kind: 'create-track-strip',
                        trackId: 'audio-1',
                        name: 'Track 1',
                        state: { gain: 0.8, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 },
                        devices: [],
                        honorMuted: true,
                        contributesAudio: false,
                    },
                    { kind: 'set-transport', playing: true, positionSeconds: 0 },
                ],
            },
        });
    });

    it('reads an applied answer with its revision and its strip reports', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({
                acceptance: 'accepted',
                application: 'applied',
                runtimeRevision: 4,
                reports: [{ kind: 'track', id: 'audio-1', deviceIds: ['device-a'] }],
            })
        );

        const result = await createNativeLiveGraphBackend({ transport }).apply(BATCH);

        expect(result).toEqual({
            acceptance: 'accepted',
            application: 'applied',
            runtimeRevision: 4,
            reports: [{ kind: 'track', id: 'audio-1', deviceIds: ['device-a'] }],
        });
    });

    it('echoes a correlation back only when the batch carried one', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({ acceptance: 'accepted', application: 'applied', runtimeRevision: 1, reports: [] })
        );
        const correlation = { appRevision: 2, projectRevision: 'rev-9' };

        const carried = await createNativeLiveGraphBackend({ transport }).apply({ ...BATCH, correlation });
        const uncorrelated = await createNativeLiveGraphBackend({ transport }).apply(BATCH);

        expect(carried).toMatchObject({ correlation });
        expect(uncorrelated).not.toHaveProperty('correlation');
    });

    it('carries a refusal through with the reason the native side gave', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({
                acceptance: 'rejected',
                application: 'not-applied',
                reason: 'engine-not-running: no default output device',
            })
        );

        const result = await createNativeLiveGraphBackend({ transport }).apply(BATCH);

        expect(result).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'engine-not-running: no default output device',
        });
    });

    it('carries a partial application as needs-reconcile, never as applied', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({
                acceptance: 'accepted',
                application: 'needs-reconcile',
                compensation: 'not-attempted',
                reason: 'the engine refused command 2 of 5',
                runtimeRevision: 7,
                reports: [{ kind: 'bus', id: 'bus-1', deviceIds: [] }],
            })
        );

        const result = await createNativeLiveGraphBackend({ transport }).apply(BATCH);

        expect(result).toEqual({
            acceptance: 'accepted',
            application: 'needs-reconcile',
            compensation: 'not-attempted',
            reason: 'the engine refused command 2 of 5',
            runtimeRevision: 7,
            reports: [{ kind: 'bus', id: 'bus-1', deviceIds: [] }],
        });
    });

    it('turns a transport failure into a refusal, so a caller reads one failure vocabulary', async () => {
        const transport = stubTransport(() => Promise.reject(new Error('bridge command not exposed')));

        const result = await createNativeLiveGraphBackend({ transport }).apply(BATCH);

        expect(result).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'bridge command not exposed',
        });
    });

    it('throws on an answer that is no outcome at all, rather than passing it as a result', async () => {
        const transport = stubTransport(() => Promise.resolve({ acceptance: 'accepted', application: 'maybe' }));

        await expect(createNativeLiveGraphBackend({ transport }).apply(BATCH)).rejects.toThrow(/unknown outcome/u);
    });

    it('throws on a malformed strip report, which is the only channel that says what a strip built', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({
                acceptance: 'accepted',
                application: 'applied',
                runtimeRevision: 1,
                reports: [{ kind: 'track', id: 'audio-1', deviceIds: [7] }],
            })
        );

        await expect(createNativeLiveGraphBackend({ transport }).apply(BATCH)).rejects.toThrow(
            /malformed strip report/u
        );
    });

    it('throws on an applied answer carrying no runtime revision', async () => {
        const transport = stubTransport(() =>
            Promise.resolve({ acceptance: 'accepted', application: 'applied', reports: [] })
        );

        await expect(createNativeLiveGraphBackend({ transport }).apply(BATCH)).rejects.toThrow(
            /malformed runtimeRevision/u
        );
    });

    it('refuses every batch after disposal without touching the transport', async () => {
        const applyGraphCommands = vi.fn().mockResolvedValue({
            acceptance: 'accepted',
            application: 'applied',
            runtimeRevision: 1,
            reports: [],
        });
        const backend = createNativeLiveGraphBackend({ transport: stubTransport(applyGraphCommands) });

        backend.dispose();
        const result = await backend.apply(BATCH);

        expect(result).toEqual({ acceptance: 'rejected', application: 'not-applied', reason: 'backend disposed' });
        expect(applyGraphCommands).not.toHaveBeenCalled();
    });
});
