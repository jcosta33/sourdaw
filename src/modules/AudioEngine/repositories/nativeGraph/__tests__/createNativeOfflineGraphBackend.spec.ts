/**
 * The native offline backend's own laws, against a scripted transport.
 *
 * Everything the backend does *between* the contract and the wire is pinned
 * here: material registered before the probe, the one-frame probe carrying
 * the whole accumulated batch, refusal-with-rollback, report derivation and
 * the interleaved-bytes round trip. What the wire's far side does with those
 * payloads is the null test's question, answered against the built addon.
 */
import { describe, expect, it, vi } from 'vitest';

import { type AudioGraphCommandBatch } from '../../../models/AudioGraphBackend';
import { createNativeOfflineGraphBackend, NATIVE_OFFLINE_BACKEND_ID } from '../createNativeOfflineGraphBackend';
import {
    type NativeGraphTransport,
    type RegisterTimelineSampleInput,
    type RenderGraphOfflineInput,
} from '../nativeGraphTransport';

const SAMPLE_RATE = 48_000;

function stereoBuffer(left: number[], right: number[]): AudioBuffer {
    const stub = {
        numberOfChannels: 2,
        length: left.length,
        sampleRate: SAMPLE_RATE,
        getChannelData: (channel: number) => new Float32Array(channel === 0 ? left : right),
    };
    // Structurally the slice of `AudioBuffer` this seam reads; the bridge cast
    // is named here once, exactly as the null-test harness names its own.
    return stub as unknown as AudioBuffer;
}

/** Interleaved stereo f32 LE bytes, as `render_graph_offline` answers them. */
function interleavedBytes(frames: number, fill: (frame: number, channel: 0 | 1) => number): Uint8Array {
    const bytes = new Uint8Array(frames * 8);
    const view = new DataView(bytes.buffer);
    for (let frame = 0; frame < frames; frame++) {
        view.setFloat32(frame * 8, fill(frame, 0), true);
        view.setFloat32(frame * 8 + 4, fill(frame, 1), true);
    }
    return bytes;
}

type ScriptedTransport = NativeGraphTransport & {
    registered: RegisterTimelineSampleInput[];
    renders: RenderGraphOfflineInput[];
};

function scriptedTransport(options?: {
    refuseRender?: (input: RenderGraphOfflineInput) => string | undefined;
    refuseRegistration?: string;
}): ScriptedTransport {
    const registered: RegisterTimelineSampleInput[] = [];
    const renders: RenderGraphOfflineInput[] = [];
    return {
        registered,
        renders,
        async registerTimelineSample(input) {
            if (options?.refuseRegistration !== undefined) {
                throw new Error(options.refuseRegistration);
            }
            registered.push(input);
            return { frames: input.pcm.byteLength / (4 * input.channels) };
        },
        async renderGraphOffline(input) {
            const refusal = options?.refuseRender?.(input);
            if (refusal !== undefined) {
                throw new Error(refusal);
            }
            renders.push(input);
            return interleavedBytes(input.frames, (frame, channel) => (channel === 0 ? frame : -frame));
        },
        applyGraphCommands: vi.fn(async () => ({ acceptance: 'accepted' })),
    };
}

function clipCommand(sourceId: string, buffer?: AudioBuffer) {
    return {
        kind: 'schedule-clip',
        playback: {
            trackId: 'track-1',
            source: buffer ? { sourceId, buffer } : { sourceId },
            startTime: 0,
            sourceOffsetSeconds: 0,
            durationSeconds: 0.25,
            playbackRate: 1,
            gain: 1,
            fade: { microFadeSeconds: 0 },
        },
    } as const;
}

const TRACK_STRIP = {
    kind: 'create-track-strip',
    trackId: 'track-1',
    name: 'Track',
    state: { gain: 1, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 },
    devices: [],
    honorMuted: true,
    contributesAudio: true,
} as const;

describe('createNativeOfflineGraphBackend', () => {
    it('names itself for parity reports', () => {
        expect(NATIVE_OFFLINE_BACKEND_ID).toBe('native/offline');
        expect(
            createNativeOfflineGraphBackend({ sampleRate: SAMPLE_RATE, transport: scriptedTransport() }).backendId
        ).toBe('native/offline');
    });

    it('registers buffered material once, little-endian interleaved, before probing the batch', async () => {
        const transport = scriptedTransport();
        const backend = createNativeOfflineGraphBackend({ sampleRate: SAMPLE_RATE, transport });
        const buffer = stereoBuffer([0.5, -1], [0.25, 1]);

        const first = await backend.apply({
            schemaVersion: 1,
            commands: [TRACK_STRIP, clipCommand('take-1', buffer)],
        });
        const second = await backend.apply({ schemaVersion: 1, commands: [clipCommand('take-1', buffer)] });

        expect(first.application).toBe('applied');
        expect(second.application).toBe('applied');
        // Once: the id names the decoded identity, and the pool holds it now.
        expect(transport.registered).toHaveLength(1);
        const registration = transport.registered[0]!;
        expect(registration.sampleId).toBe('take-1');
        expect(registration.sampleRate).toBe(SAMPLE_RATE);
        expect(registration.channels).toBe(2);
        const view = new DataView(registration.pcm.buffer, registration.pcm.byteOffset);
        expect(view.getFloat32(0, true)).toBe(0.5);
        expect(view.getFloat32(4, true)).toBe(0.25);
        expect(view.getFloat32(8, true)).toBe(-1);
        expect(view.getFloat32(12, true)).toBe(1);
        // Both applies probed, at one frame, and the second probe carried the
        // whole accumulated batch — statefulness is the backend's, not the
        // stateless render command's.
        expect(transport.renders.map((render) => render.frames)).toEqual([1, 1]);
        expect(transport.renders[0]!.batch.commands).toHaveLength(2);
        expect(transport.renders[1]!.batch.commands).toHaveLength(3);
    });

    it('passes an identity-only source through and lets the pool answer for it', async () => {
        const transport = scriptedTransport();
        const backend = createNativeOfflineGraphBackend({ sampleRate: SAMPLE_RATE, transport });

        const result = await backend.apply({
            schemaVersion: 1,
            commands: [TRACK_STRIP, clipCommand('registered-elsewhere')],
        });

        expect(result.application).toBe('applied');
        expect(transport.registered).toHaveLength(0);
    });

    it('rejects with the native refusal reason and rolls the batch back whole', async () => {
        const transport = scriptedTransport({
            refuseRender: (input) =>
                input.batch.commands.some(
                    (command) => command.kind === 'schedule-clip' && command.playback.playbackRate !== 1
                )
                    ? 'commands[1]: schedule-clip: stretched-clip-unsupported — playbackRate 0.5 refused'
                    : undefined,
        });
        const backend = createNativeOfflineGraphBackend({ sampleRate: SAMPLE_RATE, transport });

        await backend.apply({ schemaVersion: 1, commands: [TRACK_STRIP] });
        const refused = await backend.apply({
            schemaVersion: 1,
            commands: [
                {
                    ...clipCommand('take-1', stereoBuffer([0], [0])),
                    playback: { ...clipCommand('take-1').playback, playbackRate: 0.5 },
                },
            ],
        });

        expect(refused).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'commands[1]: schedule-clip: stretched-clip-unsupported — playbackRate 0.5 refused',
        });
        // Rollback: the refused command never enters a later wire batch.
        await backend.render(4);
        const rendered = transport.renders.at(-1)!;
        expect(rendered.frames).toBe(4);
        expect(rendered.batch.commands).toHaveLength(1);
        expect(rendered.batch.commands[0]!.kind).toBe('create-track-strip');
    });

    it('rejects when the material itself is refused at registration', async () => {
        const backend = createNativeOfflineGraphBackend({
            sampleRate: SAMPLE_RATE,
            transport: scriptedTransport({ refuseRegistration: 'PCM payload holds zero frames' }),
        });

        const result = await backend.apply({
            schemaVersion: 1,
            commands: [clipCommand('take-1', stereoBuffer([], []))],
        });

        expect(result).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'register_timeline_sample "take-1": PCM payload holds zero frames',
        });
    });

    it('derives strip reports by the accepted-batch law map_device applies', async () => {
        const backend = createNativeOfflineGraphBackend({ sampleRate: SAMPLE_RATE, transport: scriptedTransport() });

        const result = await backend.apply({
            schemaVersion: 1,
            correlation: { appRevision: 2, projectRevision: 'rev-4' },
            commands: [
                {
                    ...TRACK_STRIP,
                    // A strip built only for routing fidelity: the non-knead
                    // device degrades rather than refusing, so it is absent
                    // from the report the contract says a caller must read.
                    contributesAudio: false,
                    devices: [
                        {
                            id: 'dev-knead',
                            name: 'Knead',
                            type: 'Knead',
                            bypassed: false,
                            parameterValues: {},
                        },
                        {
                            id: 'dev-web-only',
                            name: 'Filter',
                            type: 'builtin-filter',
                            bypassed: false,
                            parameterValues: {},
                        },
                    ],
                },
                {
                    kind: 'create-bus-strip',
                    busId: 'bus-1',
                    name: 'Bus',
                    state: { gain: 0.9, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 },
                    devices: [],
                    honorMuted: true,
                    contributesAudio: true,
                },
            ],
        });

        expect(result).toEqual({
            acceptance: 'accepted',
            application: 'applied',
            correlation: { appRevision: 2, projectRevision: 'rev-4' },
            runtimeRevision: 1,
            reports: [
                { kind: 'track', id: 'track-1', deviceIds: ['dev-knead'] },
                { kind: 'bus', id: 'bus-1', deviceIds: [] },
            ],
        });
    });

    it('renders the accumulated batch and hands back the planar pair', async () => {
        const transport = scriptedTransport();
        const backend = createNativeOfflineGraphBackend({ sampleRate: SAMPLE_RATE, transport });
        await backend.apply({ schemaVersion: 1, commands: [TRACK_STRIP] });

        const { left, right } = await backend.render(3);

        expect([...left]).toEqual([0, 1, 2]);
        expect([...right]).toEqual([-0, -1, -2]);
        expect(transport.renders.at(-1)).toMatchObject({ frames: 3, sampleRate: SAMPLE_RATE });
    });

    it('refuses a schema version it does not speak, and everything after dispose', async () => {
        const backend = createNativeOfflineGraphBackend({ sampleRate: SAMPLE_RATE, transport: scriptedTransport() });

        // The wire mirror speaks schema 1; a batch from a newer vocabulary is
        // refused before serialization rather than misread on the far side.
        // The cast exists because the type system already forbids this shape —
        // the runtime guard is for payloads that never went through it.
        const wrongSchema = await backend.apply({
            schemaVersion: 2,
            commands: [],
        } as unknown as AudioGraphCommandBatch);
        expect(wrongSchema.acceptance).toBe('rejected');

        backend.dispose();
        backend.dispose();
        const afterDispose = await backend.apply({ schemaVersion: 1, commands: [] });
        expect(afterDispose).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'backend disposed',
        });
        await expect(backend.render(1)).rejects.toThrow('native offline backend disposed');
    });
});
