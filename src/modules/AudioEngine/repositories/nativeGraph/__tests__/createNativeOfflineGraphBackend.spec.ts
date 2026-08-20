/**
 * The native offline backend's own laws, against a scripted transport.
 *
 * Everything the backend does *between* the contract and the wire is pinned
 * here: material registered before the probe, the render-nothing mapping
 * probe carrying the committed prior beside the incoming batch,
 * refusal-with-rollback, wire-fed reports and the interleaved-bytes round
 * trip — and the line between a batch refusal, which resolves, and a seam
 * fault, which throws. What the wire's far side does with those payloads is
 * the null test's question, answered against the built addon.
 */
import { describe, expect, it, vi } from 'vitest';

import { type AudioGraphCommandBatch } from '../../../models/AudioGraphBackend';
import { createNativeOfflineGraphBackend, NATIVE_OFFLINE_BACKEND_ID } from '../createNativeOfflineGraphBackend';
import {
    type MapGraphBatchInput,
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
    maps: MapGraphBatchInput[];
};

function scriptedTransport(options?: {
    /** Answer the wire's `rejected` result for a probe, by reason. */
    refuseMap?: (input: MapGraphBatchInput) => string | undefined;
    /** Script the wire's reports for an accepted probe. */
    reports?: (input: MapGraphBatchInput) => unknown;
    refuseRegistration?: string;
}): ScriptedTransport {
    const registered: RegisterTimelineSampleInput[] = [];
    const renders: RenderGraphOfflineInput[] = [];
    const maps: MapGraphBatchInput[] = [];
    return {
        registered,
        renders,
        maps,
        async registerTimelineSample(input) {
            if (options?.refuseRegistration !== undefined) {
                throw new Error(options.refuseRegistration);
            }
            registered.push(input);
            return { frames: input.pcm.byteLength / (4 * input.channels) };
        },
        async renderGraphOffline(input) {
            renders.push(input);
            return interleavedBytes(input.frames, (frame, channel) => (channel === 0 ? frame : -frame));
        },
        async mapGraphBatch(input) {
            const refusal = options?.refuseMap?.(input);
            if (refusal !== undefined) {
                // A batch refusal is the wire's `rejected` result, never a
                // thrown transport error — the addon's one failure vocabulary.
                return { acceptance: 'rejected', application: 'not-applied', reason: refusal };
            }
            maps.push(input);
            return {
                acceptance: 'accepted',
                application: 'applied',
                ...(input.batch.correlation !== undefined ? { correlation: input.batch.correlation } : {}),
                reports: options?.reports?.(input) ?? [],
            };
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
        // Both applies probed with nothing rendered: the committed commands
        // ride as the prior, the incoming batch alone rides as the batch —
        // the split that scopes reports and refusal indices to this apply.
        expect(transport.renders).toHaveLength(0);
        expect(transport.maps.map((probe) => probe.prior.length)).toEqual([0, 2]);
        expect(transport.maps.map((probe) => probe.batch.commands.length)).toEqual([2, 1]);
        expect(transport.maps[1]!.sampleRate).toBe(SAMPLE_RATE);
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
            refuseMap: (input) =>
                input.batch.commands.some(
                    (command) => command.kind === 'schedule-clip' && command.playback.playbackRate !== 1
                )
                    ? 'commands[0]: schedule-clip: stretched-clip-unsupported — playbackRate 0.5 refused'
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

        // The wire's `rejected` result surfaces as this backend's own
        // rejection, reason verbatim.
        expect(refused).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'commands[0]: schedule-clip: stretched-clip-unsupported — playbackRate 0.5 refused',
        });
        // Rollback: the refused command never enters a later wire batch.
        await backend.render(4);
        const rendered = transport.renders.at(-1)!;
        expect(rendered.frames).toBe(4);
        expect(rendered.batch.commands).toHaveLength(1);
        expect(rendered.batch.commands[0]!.kind).toBe('create-track-strip');

        // And the backend forgot material a refused batch sent ahead of its
        // probe (a schedule-clip probe must find its sample in the pool): a
        // retry re-registers the identity — replace-idempotent natively —
        // rather than trusting a set the rejected batch mutated.
        const material = stereoBuffer([0], [0]);
        const refusedWithMaterial = await backend.apply({
            schemaVersion: 1,
            commands: [
                {
                    ...clipCommand('take-2', material),
                    playback: { ...clipCommand('take-2', material).playback, playbackRate: 0.5 },
                },
            ],
        });
        expect(refusedWithMaterial.application).toBe('not-applied');
        expect(transport.registered).toHaveLength(1);
        const retried = await backend.apply({ schemaVersion: 1, commands: [clipCommand('take-2', material)] });
        expect(retried.application).toBe('applied');
        expect(transport.registered).toHaveLength(2);
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

    it('hands back the reports the wire answered and keeps the revision counter its own', async () => {
        // Reports a TS-side derivation could never produce — a chain the
        // *prior* built plus this batch's edit — prove the reports are read
        // off the wire, not restated from the incoming commands.
        const backend = createNativeOfflineGraphBackend({
            sampleRate: SAMPLE_RATE,
            transport: scriptedTransport({
                reports: (input) =>
                    input.prior.length === 0
                        ? [{ kind: 'track', id: 'track-1', deviceIds: [] }]
                        : [{ kind: 'track', id: 'track-1', deviceIds: ['dev-prior', 'dev-new'] }],
            }),
        });

        await backend.apply({ schemaVersion: 1, commands: [TRACK_STRIP] });
        const result = await backend.apply({
            schemaVersion: 1,
            correlation: { appRevision: 2, projectRevision: 'rev-4' },
            commands: [
                {
                    kind: 'insert-device',
                    trackId: 'track-1',
                    index: 1,
                    device: {
                        id: 'dev-new',
                        name: 'Knead',
                        type: 'Knead',
                        bypassed: false,
                        parameterValues: {},
                    },
                },
            ],
        });

        expect(result).toEqual({
            acceptance: 'accepted',
            application: 'applied',
            correlation: { appRevision: 2, projectRevision: 'rev-4' },
            // The mapping wire carries no runtimeRevision — a mapping has no
            // runtime — so the counter here is this backend's own, advancing
            // once per accepted batch.
            runtimeRevision: 2,
            reports: [{ kind: 'track', id: 'track-1', deviceIds: ['dev-prior', 'dev-new'] }],
        });
    });

    it('crosses each probe under the applied batch correlation, absent when the batch carries none', async () => {
        const transport = scriptedTransport();
        const backend = createNativeOfflineGraphBackend({ sampleRate: SAMPLE_RATE, transport });

        await backend.apply({
            schemaVersion: 1,
            correlation: { appRevision: 1, projectRevision: 'rev-1' },
            commands: [TRACK_STRIP],
        });
        await backend.apply({ schemaVersion: 1, commands: [] });
        await backend.apply({
            schemaVersion: 1,
            correlation: { appRevision: 2, projectRevision: 'rev-2' },
            commands: [],
        });
        await backend.render(2);

        // A batch's own correlation crosses on its own probe.
        expect(transport.maps[0]!.batch.correlation).toEqual({ appRevision: 1, projectRevision: 'rev-1' });
        // A correlation-free batch crosses with no correlation key at all,
        // even immediately after a correlated batch was accepted — absence is
        // meaningful (`serializeAudioGraphCommandBatch`'s law: an absent
        // correlation is "not correlated" and must not trip the native side's
        // validation), so nothing may stick from a predecessor.
        expect('correlation' in transport.maps[1]!.batch).toBe(false);
        // And a later correlated batch crosses under its own key, not rev-1.
        expect(transport.maps[2]!.batch.correlation).toEqual({ appRevision: 2, projectRevision: 'rev-2' });
        // The render applies no batch and carries none.
        expect(transport.renders).toHaveLength(1);
        expect('correlation' in transport.renders[0]!.batch).toBe(false);
    });

    it('renders the accumulated batch and hands back the planar pair', async () => {
        const transport = scriptedTransport();
        const backend = createNativeOfflineGraphBackend({ sampleRate: SAMPLE_RATE, transport });
        await backend.apply({ schemaVersion: 1, commands: [TRACK_STRIP] });

        const { left, right } = await backend.render(3);

        expect([...left]).toEqual([0, 1, 2]);
        expect([...right]).toEqual([-0, -1, -2]);
        expect(transport.renders.at(-1)).toMatchObject({ frames: 3, sampleRate: SAMPLE_RATE });
        // The render batch is the committed commands — mapping probes never
        // rendered them.
        expect(transport.renders.at(-1)!.batch.commands).toHaveLength(1);
    });

    it('throws a prior-fault transport error instead of blaming the incoming batch', async () => {
        const transport = scriptedTransport();
        const backend = createNativeOfflineGraphBackend({
            sampleRate: SAMPLE_RATE,
            transport: {
                ...transport,
                async mapGraphBatch() {
                    throw new Error('previously applied commands no longer map: duplicate track id "track-1"');
                },
            },
        });

        // The prefix is the wire's fault marker: the already-accepted commands
        // failed to replay, so this is a broken seam, not a refusal of the
        // batch the caller just sent.
        await expect(backend.apply({ schemaVersion: 1, commands: [TRACK_STRIP] })).rejects.toThrow(
            'previously applied commands no longer map'
        );
    });

    it('throws on wire shapes the mapping result vocabulary does not contain', async () => {
        const transport = scriptedTransport();
        const unknownOutcome = createNativeOfflineGraphBackend({
            sampleRate: SAMPLE_RATE,
            transport: {
                ...transport,
                async mapGraphBatch() {
                    return { acceptance: 'accepted', application: 'needs-reconcile' };
                },
            },
        });
        await expect(unknownOutcome.apply({ schemaVersion: 1, commands: [TRACK_STRIP] })).rejects.toThrow(
            'map_graph_batch answered an unknown outcome'
        );

        const malformedReports = createNativeOfflineGraphBackend({
            sampleRate: SAMPLE_RATE,
            transport: scriptedTransport({
                reports: () => [{ kind: 'track', id: 'track-1', deviceIds: 'dev-1' }],
            }),
        });
        await expect(malformedReports.apply({ schemaVersion: 1, commands: [TRACK_STRIP] })).rejects.toThrow(
            'map_graph_batch answered a malformed strip report'
        );
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
