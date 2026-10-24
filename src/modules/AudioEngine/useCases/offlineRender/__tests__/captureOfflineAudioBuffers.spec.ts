import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Track } from '#/modules/Arrangement/stores';

import { withNativeTimelineMaterialTransport } from '../../../repositories/nativeGraph/__tests__/withNativeTimelineMaterialTransport';
import { type NativeGraphTransport } from '../../../repositories/nativeGraph/nativeGraphTransport';
import { nativeTimelineMaterialLeases } from '../../../repositories/nativeGraph/nativeTimelineMaterialLeases';
import { captureOfflineAudioBuffers } from '../captureOfflineAudioBuffers';

function track(): Track {
    return {
        id: 'track',
        name: 'Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#fff',
        clips: [
            {
                id: 'clip',
                trackId: 'track',
                name: 'Clip',
                type: 'audio',
                startBeat: 0,
                endBeat: 1,
                audioBufferId: 'take',
                gain: 1,
                color: '#fff',
                locked: false,
                muted: false,
            },
        ],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'hw_out',
        automationMode: 'off',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt',
        alternatives: [{ id: 'alt', name: 'Alternative', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

class OwnedAudioBuffer {
    readonly numberOfChannels = 1;
    readonly length = 4;
    readonly sampleRate = 48_000;
    readonly duration = 4 / 48_000;
    private readonly pcm = new Float32Array(4);
    getChannelData(): Float32Array {
        return this.pcm;
    }
    copyToChannel(data: Float32Array): void {
        this.pcm.set(data);
    }
    copyFromChannel(destination: Float32Array): void {
        destination.set(this.pcm);
    }
}

afterEach(async () => {
    await nativeTimelineMaterialLeases.retire();
    vi.unstubAllGlobals();
});

describe('native ownership at the real offline copy producer', () => {
    it('uploads the private captured PCM after the source changes and refuses its owner after retirement', async () => {
        vi.stubGlobal('AudioBuffer', OwnedAudioBuffer);
        const original = new OwnedAudioBuffer();
        original.getChannelData().fill(0.25);
        const captured = captureOfflineAudioBuffers([track()], { get: () => original });
        original.getChannelData().fill(0.75);
        const uploaded: Uint8Array[] = [];
        const unexpected = async (): Promise<never> => {
            throw new Error('unexpected graph operation');
        };
        const wire: NativeGraphTransport = withNativeTimelineMaterialTransport({
            registerTimelineSample: async ({ pcm }) => {
                uploaded.push(pcm);
            },
            beginLevainBank: unexpected,
            registerLevainSample: unexpected,
            commitLevainBank: unexpected,
            releaseLevainBank: unexpected,
            applyGraphCommands: unexpected,
            mapGraphBatch: unexpected,
            renderGraphOffline: unexpected,
        });
        const owner = nativeTimelineMaterialLeases.captureOwner();
        const consumer = nativeTimelineMaterialLeases.createConsumer(wire, owner);
        const commands = [
            {
                kind: 'schedule-clip' as const,
                playback: {
                    trackId: 'track',
                    source: { sourceId: 'take', buffer: captured.get('take')! },
                    startTime: 0,
                    sourceOffsetSeconds: 0,
                    durationSeconds: 4 / 48_000,
                    playbackRate: 1,
                    gain: 1,
                    fade: { microFadeSeconds: 0 },
                },
            },
        ];
        const claim = await consumer.run(() => consumer.prepare(commands));
        expect(new DataView(uploaded[0]!.buffer).getFloat32(0, true)).toBe(0.25);
        await consumer.accept(claim);
        await nativeTimelineMaterialLeases.retire(owner);
        const successor = nativeTimelineMaterialLeases.createConsumer(wire);
        await expect(successor.run(() => successor.prepare(commands))).rejects.toThrow('owned snapshot');
        successor.dispose();
    });
});
