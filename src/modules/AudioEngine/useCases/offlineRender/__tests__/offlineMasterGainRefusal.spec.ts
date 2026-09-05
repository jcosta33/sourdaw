/**
 * Neither offline backend accepts the master fader (#3596).
 *
 * `set-master-gain` is a live-session command: it aims the smoother a rolling
 * engine advances per sample. An offline render has no such engine — it applies
 * the project's master level itself, over the rendered block — so a backend that
 * accepted the command would either apply the level twice or silently ignore it,
 * and a bounce would stop matching what the same project plays live.
 *
 * The two backends are asserted together because the contract is the contract's,
 * not either backend's: an offline `AudioGraphBackend` refuses this command,
 * whichever engine is behind it.
 */

import { describe, expect, it, vi } from 'vitest';

import { type AudioGraphBackend, type AudioGraphCommandBatch } from '../../../models/AudioGraphBackend';
import { createNativeOfflineGraphBackend } from '../../../repositories/nativeGraph/createNativeOfflineGraphBackend';
import { type NativeGraphTransport } from '../../../repositories/nativeGraph/nativeGraphTransport';

vi.mock('../../buildDeviceChain', () => ({
    buildDeviceChain: vi.fn(async () => []),
}));

const { createWebAudioOfflineBackend } = await import('../createWebAudioOfflineBackend');

const SAMPLE_RATE = 48_000;

const FADER_BATCH: AudioGraphCommandBatch = {
    schemaVersion: 1,
    commands: [{ kind: 'set-master-gain', gain: 0.35 }],
};

/** Every call is a defect: the refusal precedes the wire. */
function unreachableTransport(): NativeGraphTransport {
    const refuse = (call: string) => () => {
        throw new Error(`${call} must not be reached by a refused batch`);
    };
    return {
        registerTimelineSample: refuse('register_timeline_sample'),
        renderGraphOffline: refuse('render_graph_offline'),
        applyGraphCommands: refuse('apply_graph_commands'),
        mapGraphBatch: refuse('map_graph_batch'),
    };
}

function offlineBackends(): readonly AudioGraphBackend[] {
    const masterNode = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } };
    const context = {
        createGain: () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1, setValueAtTime: vi.fn() } }),
        createStereoPanner: () => ({
            connect: vi.fn(),
            disconnect: vi.fn(),
            pan: { value: 0, setValueAtTime: vi.fn() },
        }),
    } as unknown as OfflineAudioContext;

    return [
        createWebAudioOfflineBackend({ context, masterNode: masterNode as unknown as AudioNode }),
        createNativeOfflineGraphBackend({ sampleRate: SAMPLE_RATE, transport: unreachableTransport() }),
    ];
}

describe('the master fader against an offline backend', () => {
    it('is refused by both offline backends, each naming its own reason', async () => {
        for (const backend of offlineBackends()) {
            const result = await backend.apply(FADER_BATCH);

            expect(result).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
            expect(result.acceptance === 'rejected' ? result.reason : '').toContain('set-master-gain');
        }
    });
});
