import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decayToRt60Seconds } from '#/utils/reverbDecayLaw';

import { createTrack } from '../../../models/Track';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { trackStore } from '../../../stores/trackStore';
import { activeFreezeTasks, freezeTrack } from '../freezeTrack';
import { renderTrackOffline } from '../renderOffline';

vi.mock('../../../repositories/track/updateTrack', () => ({ updateTrack: vi.fn() }));
vi.mock('../../../services/computeTrackHash', () => ({
    computeTrackHash: vi.fn().mockResolvedValue('mock-hash'),
}));
vi.mock('../renderOffline', () => ({ renderTrackOffline: vi.fn() }));

// The real tail machinery runs — that it is the *same* machinery the export
// path evaluates is the whole claim of this file, so stubbing it would prove
// nothing. Only the two I/O helpers freeze needs are replaced.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cacheAudioBuffer: vi.fn(),
    getCompensationDelay: vi.fn(() => 0),
}));

const transportMock = vi.hoisted<{ value: { tempo: number } | null }>(() => ({ value: { tempo: 120 } }));
vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: {
        get value() {
            return transportMock.value;
        },
    },
}));

const renderedBuffer = { sampleRate: 48_000, numberOfChannels: 2 } as AudioBuffer;

type FrozenRenderSettings = { tailLengthSeconds: number };

/** The `renderSettings` freeze wrote, read back off the `updateTrack` updater. */
function readRecordedRenderSettings(): FrozenRenderSettings {
    const calls = vi.mocked(updateTrack).mock.calls;
    for (let index = calls.length - 1; index >= 0; index--) {
        const updater = calls[index]![1];
        const next = updater(createTrack({ id: 't1', name: 'Track', kind: 'midi' }));
        const settings = next.freezeState.renderSettings;
        if (settings) {
            return settings;
        }
    }
    throw new Error('freeze recorded no render settings');
}

/** Tail seconds freeze asked the render for. */
function readRequestedTailSeconds(): number {
    const call = vi.mocked(renderTrackOffline).mock.calls.at(-1);
    if (!call) {
        throw new Error('freeze started no render');
    }
    return call[3]?.tailSeconds ?? 0;
}

function seedTrackWithDevice(deviceType: string, parameterValues: Record<string, number> = {}) {
    const track = createTrack({ id: 't1', name: 'Track', kind: 'midi' });
    track.clips = [
        {
            id: 'c1',
            trackId: 't1',
            name: 'Clip',
            startBeat: 0,
            endBeat: 4,
            type: 'midi',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#fff',
            locked: false,
            muted: false,
        },
    ];
    track.devices = [{ id: 'd1', type: deviceType, name: deviceType, bypassed: false, parameterValues }];
    trackStore.set({ tracks: [track], selectedTrackId: null });
}

/**
 * Freeze used to size its tail from a substring test on the device type
 * (`includes('reverb') || includes('delay')` → 8 beats, else 4), which is
 * disconnected from the declarations every other render path evaluates. The
 * Dutch Oven is the plain example: it is the ProofChamber reverb and its id
 * contains neither word, so it scored the short tail.
 */
describe('freeze sizes its tail from device tail declarations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
        transportMock.value = { tempo: 120 };
        activeFreezeTasks.clear();
        vi.mocked(renderTrackOffline).mockResolvedValue(renderedBuffer);
    });

    it('reserves a long Dutch Oven decay the substring test could not see', async () => {
        // `decay` is normalised, and the law carries the top of the knob out to
        // tens of seconds. This is the case that loses audio: the device id
        // contains neither "reverb" nor "delay", so it scored the *short* tail.
        seedTrackWithDevice('dutch-oven', { decay: 0.9 });

        await freezeTrack('t1');

        const declaredSeconds = decayToRt60Seconds(0.9);
        expect(readRequestedTailSeconds()).toBeCloseTo(declaredSeconds, 6);
        expect(readRecordedRenderSettings().tailLengthSeconds).toBeCloseTo(declaredSeconds, 6);

        // The old heuristic gave this device 4 beats — 2 s at 120 BPM — so the
        // reverb was cut off with most of its decay unrendered.
        expect(declaredSeconds).toBeGreaterThan(2);
    });

    it('reserves the Dutch Oven’s declared decay at its default setting', async () => {
        seedTrackWithDevice('dutch-oven');

        await freezeTrack('t1');

        expect(readRecordedRenderSettings().tailLengthSeconds).toBeCloseTo(decayToRt60Seconds(0.5), 6);
    });

    it('reserves the same seconds regardless of tempo', async () => {
        seedTrackWithDevice('dutch-oven');
        await freezeTrack('t1');
        const atSlowTempo = readRecordedRenderSettings().tailLengthSeconds;

        vi.clearAllMocks();
        vi.mocked(renderTrackOffline).mockResolvedValue(renderedBuffer);
        transportMock.value = { tempo: 180 };
        seedTrackWithDevice('dutch-oven');
        await freezeTrack('t1');

        // A tail measured in beats shrinks as the session speeds up, so the same
        // reverb lost about a third of its decay at 180 BPM. A declared tail is
        // a duration, and durations do not move with tempo.
        expect(readRecordedRenderSettings().tailLengthSeconds).toBeCloseTo(atSlowTempo, 6);
    });

    it('reserves nothing past the content for a chain that declares no tail', async () => {
        seedTrackWithDevice('builtin-eq');

        await freezeTrack('t1');

        expect(readRequestedTailSeconds()).toBe(0);
        expect(readRecordedRenderSettings().tailLengthSeconds).toBe(0);
    });

    it('renders the content region itself, leaving the tail to the render’s own tail input', async () => {
        seedTrackWithDevice('dutch-oven');

        await freezeTrack('t1');

        const call = vi.mocked(renderTrackOffline).mock.calls.at(-1)!;
        // Start and end are the clip bounds; the tail is seconds, not beats
        // bolted onto `endBeat`, so a tempo map cannot distort it.
        expect(call[1]).toBe(0);
        expect(call[2]).toBe(4);
    });
});
