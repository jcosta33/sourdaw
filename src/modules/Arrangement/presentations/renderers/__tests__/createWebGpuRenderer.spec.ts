import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type TimelineRenderModel } from '../../../models/TimelineRenderModel';
import { computeMidiNoteBeatSpan } from '../createWebGpuRenderer';

type GetCachedAudioBufferMock = (input: { bufferId: string }) => AudioBuffer | null;

type GetCachedAudioBufferWaveformPeaksMock = (input: {
    bufferId: string;
    numBins: number;
    startSample?: number;
    endSample?: number;
}) => Float32Array;

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn<GetCachedAudioBufferMock>(),
    getCachedAudioBufferWaveformPeaks: vi.fn<GetCachedAudioBufferWaveformPeaksMock>(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
    getCachedAudioBufferWaveformPeaks: mocks.getCachedAudioBufferWaveformPeaks,
}));

const original_device_pixel_ratio = window.devicePixelRatio;

const create_test_audio_buffer = (sampleRate = 48_000): AudioBuffer => {
    const channel_data = new Float32Array(96_000);
    return {
        copyFromChannel: (destination, _channel_number, start_in_channel = 0) => {
            destination.set(channel_data.subarray(start_in_channel, start_in_channel + destination.length));
        },
        copyToChannel: (source, _channel_number, start_in_channel = 0) => {
            channel_data.set(source, start_in_channel);
        },
        duration: channel_data.length / sampleRate,
        getChannelData: () => channel_data,
        length: channel_data.length,
        numberOfChannels: 1,
        sampleRate,
    };
};

const create_test_model = (): TimelineRenderModel => ({
    dataDirty: false,
    tracks: [
        {
            id: 'track-1',
            name: 'Audio',
            index: 0,
            kind: 'audio',
            color: '#224466',
            muted: false,
            soloed: false,
            height: 48,
            automationMode: 'read',
            clips: [
                {
                    id: 'clip-1',
                    startBeat: 2,
                    endBeat: 6,
                    name: 'Audio Clip',
                    color: '#336699',
                    type: 'audio',
                    muted: false,
                    midiNotes: [],
                    audioBufferId: 'buf-1',
                    audioOffsetBeats: 1,
                    stretchRatio: 2,
                    loopEnabled: false,
                    loopLength: undefined,
                    midiOffsetBeats: 0,
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                },
            ],
        },
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    playheadPosition: 0,
    viewportStartBeat: 0,
    viewportEndBeat: 16,
    beatsPerPixel: 1 / 25,
    pixelsPerBeat: 25,
    trackHeight: 48,
    scrollY: 0,
    tempo: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
});

type WebGpuMockHandles = {
    draw: ReturnType<typeof vi.fn>;
    writeBuffer: ReturnType<typeof vi.fn>;
};

function install_webgpu_mocks(canvas: HTMLCanvasElement): WebGpuMockHandles {
    const writeBuffer = vi.fn();
    const draw = vi.fn();
    const render_pass = {
        setPipeline: vi.fn(),
        setVertexBuffer: vi.fn(),
        draw,
        end: vi.fn(),
    };
    const gpu_context = {
        configure: vi.fn(),
        getCurrentTexture: vi.fn(() => ({
            createView: vi.fn(() => ({})),
        })),
    };
    const device = {
        createShaderModule: vi.fn(() => ({})),
        createRenderPipeline: vi.fn(() => ({})),
        createBuffer: vi.fn(({ size }: { size: number }) => ({
            size,
            destroy: vi.fn(),
        })),
        queue: {
            writeBuffer,
            submit: vi.fn(),
        },
        createCommandEncoder: vi.fn(() => ({
            beginRenderPass: vi.fn(() => render_pass),
            finish: vi.fn(() => ({})),
        })),
        destroy: vi.fn(),
    };
    const adapter = {
        requestDevice: vi.fn().mockResolvedValue(device),
    };
    const gpu = {
        requestAdapter: vi.fn().mockResolvedValue(adapter),
        getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
    };

    Object.defineProperty(canvas, 'getContext', {
        configurable: true,
        value: vi.fn((context_id: string) => {
            if (context_id === 'webgpu') {
                return gpu_context;
            }
            return null;
        }),
    });
    Object.defineProperty(navigator, 'gpu', {
        configurable: true,
        value: gpu,
    });
    vi.stubGlobal('GPUBufferUsage', {
        COPY_DST: 2,
        VERTEX: 1,
    });

    return { draw, writeBuffer };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedAudioBuffer.mockReturnValue(null);
    mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array());
    Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        value: 1,
    });
});

afterEach(() => {
    Reflect.deleteProperty(navigator, 'gpu');
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        value: original_device_pixel_ratio,
    });
});

// A full WebGPU render is not exercisable under vitest/jsdom (no GPU device),
// so the regression coverage targets the pure clip-relative coordinate math
// that was double-offsetting. This mirrors clipDrawing.spec.ts, which pins the
// Canvas renderer to the same clip-relative convention.
describe('computeMidiNoteBeatSpan (clip-relative MIDI coordinates)', () => {
    it('keeps a note.startBeat=0 note at the clip start, regardless of clip.startBeat', () => {
        // Mirrors clipDrawing.spec.ts: a clip at timeline beat 8 with a single
        // clip-relative note at beat 0. The note must land at relStartBeat 0
        // (the clip's left edge) — NOT at -clip.startBeat. Before the fix the
        // renderer subtracted clip.startBeat, yielding relStartBeat = -8, which
        // failed the visibility cull (relEndBeat <= 0) and dropped the note.
        const clipStartBeat = 8;
        const clipDuration = 12 - clipStartBeat; // clip spans beats 8..12 → 4 beats
        const note = { startBeat: 0, duration: 1 };

        const span = computeMidiNoteBeatSpan(note, /* midiOffset */ 0, /* loopOffset */ 0, clipDuration);

        expect(span.relStartBeat).toBe(0);
        expect(span.relEndBeat).toBe(1);
        expect(span.visible).toBe(true);
    });

    it('does not depend on clip.startBeat: identical relative span for clips at any timeline position', () => {
        const clipDuration = 4;
        const note = { startBeat: 2, duration: 1 };

        // The span is a function of (note, midiOffset, loopOffset, clipDuration)
        // only — clip.startBeat is not an input, so a clip at beat 0 and a clip
        // at beat 100 produce the same clip-relative span.
        const span = computeMidiNoteBeatSpan(note, 0, 0, clipDuration);

        expect(span.relStartBeat).toBe(2);
        expect(span.relEndBeat).toBe(3);
        expect(span.visible).toBe(true);
    });

    it('applies midiOffset by shifting the revealed clip-relative position', () => {
        const clipDuration = 4;
        const note = { startBeat: 2, duration: 1 };

        // midiOffset = 1 reveals content one beat earlier in the clip window.
        const span = computeMidiNoteBeatSpan(note, /* midiOffset */ 1, 0, clipDuration);

        expect(span.relStartBeat).toBe(1);
        expect(span.relEndBeat).toBe(2);
        expect(span.visible).toBe(true);
    });

    it('advances each loop repetition by loopOffset', () => {
        const clipDuration = 8;
        const note = { startBeat: 0, duration: 1 };

        const span = computeMidiNoteBeatSpan(note, 0, /* loopOffset */ 4, clipDuration);

        expect(span.relStartBeat).toBe(4);
        expect(span.relEndBeat).toBe(5);
        expect(span.visible).toBe(true);
    });

    it('enforces a minimum visual duration of 0.125 beats', () => {
        const span = computeMidiNoteBeatSpan({ startBeat: 0, duration: 0 }, 0, 0, 4);

        expect(span.relEndBeat).toBe(0.125);
    });

    it('culls a note whose tail ends at or before the clip start', () => {
        // A note pushed fully before the clip window (e.g. by midiOffset) is
        // not visible.
        const span = computeMidiNoteBeatSpan({ startBeat: 0, duration: 1 }, /* midiOffset */ 2, 0, 4);

        expect(span.relEndBeat).toBeLessThanOrEqual(0);
        expect(span.visible).toBe(false);
    });

    it('culls a note that starts at or past the clip duration', () => {
        const span = computeMidiNoteBeatSpan({ startBeat: 4, duration: 1 }, 0, 0, /* clipDuration */ 4);

        expect(span.relStartBeat).toBeGreaterThanOrEqual(4);
        expect(span.visible).toBe(false);
    });
});

describe('createWebGpuRenderer audio waveform cache reads', () => {
    it('should draw cached audio waveform peaks through AudioEngine owner use cases', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 80;
        const handles = install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer());
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array([0.1, 0.5, 0.25]));

        renderer.render(create_test_model());

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(mocks.getCachedAudioBufferWaveformPeaks).toHaveBeenCalledWith({
            bufferId: 'buf-1',
            numBins: 100,
            startSample: 24_000,
            endSample: 72_000,
        });
        expect(handles.writeBuffer).toHaveBeenCalled();
        expect(handles.draw).toHaveBeenCalled();
    });

    it('should skip waveform peak reads when the cached audio buffer is missing', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 80;
        install_webgpu_mocks(canvas);
        const { createWebGpuRenderer } = await import('../createWebGpuRenderer');
        const renderer = await createWebGpuRenderer(canvas);
        if (!renderer) {
            throw new Error('expected WebGPU renderer');
        }
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        renderer.render(create_test_model());

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(mocks.getCachedAudioBufferWaveformPeaks).not.toHaveBeenCalled();
    });
});
