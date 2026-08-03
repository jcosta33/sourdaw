import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ClipRenderModel, type TimelineRenderModel } from '../../../models/TimelineRenderModel';
import { drawClip } from '../clipDrawing';
import { computeClipLabelLayout } from '../clipLabel';

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

const create_test_model = (overrides: Partial<TimelineRenderModel> = {}): TimelineRenderModel => ({
    dataDirty: false,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    playheadPosition: 0,
    viewportStartBeat: 0,
    viewportEndBeat: 16,
    beatsPerPixel: 1 / 25,
    pixelsPerBeat: 25,
    trackHeight: 40,
    scrollY: 0,
    tempo: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    ...overrides,
});

const create_audio_clip = (overrides: Partial<ClipRenderModel> = {}): ClipRenderModel => ({
    id: 'audio-clip-1',
    startBeat: 2,
    endBeat: 6,
    name: 'Audio Clip',
    color: '#000',
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
    ...overrides,
});

describe('drawClip (Coordinate Conventions)', () => {
    let mockCtx: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCachedAudioBuffer.mockReturnValue(null);
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array());
        mockCtx = {
            beginPath: vi.fn(),
            closePath: vi.fn(),
            roundRect: vi.fn(),
            fill: vi.fn(),
            strokeStyle: '',
            fillStyle: '',
            shadowColor: '',
            shadowBlur: 0,
            shadowOffsetY: 0,
            stroke: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            rect: vi.fn(),
            clearRect: vi.fn(),
            clip: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            fillRect: vi.fn(),
            createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
            arc: vi.fn(),
            measureText: vi.fn().mockReturnValue({ width: 10 }),
            fillText: vi.fn(),
        };
    });

    it('draws notes using clip-relative coordinates, regardless of the clip absolute startBeat', () => {
        const clip: ClipRenderModel = {
            id: 'c1',
            startBeat: 8, // Clip starts at beat 8 on timeline
            endBeat: 12,
            name: 'Test Clip',
            type: 'midi',
            midiNotes: [
                {
                    id: 'n1',
                    clipId: 'c1',
                    startBeat: 0, // Clip-relative
                    duration: 1,
                    pitch: 60,
                    velocity: 100,
                },
            ],
            isSelected: false,
            color: '#000',
            trackId: 't1',
            opacity: 1,
            audioBufferId: null,
            loopEnabled: false,
            loopLength: null,
            midiOffsetBeats: 0,
        } as any;

        const model = create_test_model();

        const trackY = 100;
        const trackHeight = 10;

        drawClip(mockCtx, clip, model, trackY, trackHeight);

        // The note should be drawn at the very beginning of the clip visual bounds.
        // x = (8 - 0) * 25 = 200 (clipX)
        // w = (12 - 8) * 25 = 100 (clipW)
        // nx = 200 + (0 / 4) * 100 = 200

        // Because trackHeight = 10 (<= 24), it is inline, so it draws using roundRect
        const noteCall = mockCtx.roundRect.mock.calls.find((args: any[]) => args[0] === 200 && args[2] <= 100);
        expect(noteCall).toBeTruthy();
        expect(noteCall[0]).toBe(200);
    });

    it('draws the clip name at the shared label geometry, condensed to the clip width', () => {
        const clip = {
            id: 'c1',
            startBeat: 8,
            endBeat: 12,
            name: 'Lead Vox',
            type: 'audio',
            midiNotes: [],
            isSelected: false,
            color: '#000',
            trackId: 't1',
            opacity: 1,
            audioBufferId: null,
            loopEnabled: false,
            loopLength: null,
            midiOffsetBeats: 0,
            fadeInBeats: 0,
            fadeOutBeats: 0,
        } as unknown as ClipRenderModel;

        // x = (8 - 0) * 25 = 200, w = (12 - 8) * 25 = 100, trackY = 48.
        drawClip(mockCtx, clip, create_test_model(), 48, 60);

        const layout = computeClipLabelLayout({ clipXCssPx: 200, clipWidthCssPx: 100, trackYCssPx: 48 });
        expect(mockCtx.fillText).toHaveBeenCalledWith(
            'Lead Vox',
            layout.xCssPx,
            layout.baselineYCssPx,
            layout.maxWidthCssPx
        );
    });

    it('draws no clip name once the clip is narrower than its own insets', () => {
        const clip = {
            id: 'c1',
            startBeat: 8,
            // 0.4 beats × 25 px/beat = 10 px wide, below the 12 px of inset.
            endBeat: 8.4,
            name: 'Lead Vox',
            type: 'audio',
            midiNotes: [],
            isSelected: false,
            color: '#000',
            trackId: 't1',
            opacity: 1,
            audioBufferId: null,
            loopEnabled: false,
            loopLength: null,
            midiOffsetBeats: 0,
            fadeInBeats: 0,
            fadeOutBeats: 0,
        } as unknown as ClipRenderModel;

        drawClip(mockCtx, clip, create_test_model(), 48, 60);

        const nameCalls = mockCtx.fillText.mock.calls.filter((args: unknown[]) => args[0] === 'Lead Vox');
        expect(nameCalls).toEqual([]);
    });

    it('does not stack-overflow when an inline-editing clip has very many notes', () => {
        // Regression: the inline path used Math.min(...notes.map()) / Math.max(...),
        // which throws `RangeError: Maximum call stack size exceeded` once the spread
        // argument count gets large. The fix folds the extent into a single loop.
        const noteCount = 150_000;
        const midiNotes = Array.from({ length: noteCount }, (_unused, index) => ({
            id: `n${index}`,
            clipId: 'big',
            startBeat: (index % 16) / 4,
            duration: 0.25,
            pitch: 36 + (index % 60),
            velocity: 100,
        }));

        const clip: ClipRenderModel = {
            id: 'big',
            startBeat: 0,
            endBeat: 4,
            name: 'Big Clip',
            type: 'midi',
            midiNotes,
            color: '#000',
            muted: false,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            isInlineEditing: true, // forces the inline extent path
        } as any;

        const model: TimelineRenderModel = {
            tracks: [],
            viewportStartBeat: 0,
            viewportEndBeat: 16,
            pixelsPerBeat: 25,
            selectedClipIds: [],
            selectedClipId: null,
        } as any;

        // isInlineEditing:true exercises the padded-extent path that used the spread.
        expect(() => drawClip(mockCtx, clip, model, 0, 30)).not.toThrow();
    });

    it('should draw cached audio waveform peaks through AudioEngine owner use cases', () => {
        const buffer = create_test_audio_buffer();
        mocks.getCachedAudioBuffer.mockReturnValue(buffer);
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array([0.1, 0.5, 0.25]));

        drawClip(mockCtx, create_audio_clip(), create_test_model(), 0, 40);

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(mocks.getCachedAudioBufferWaveformPeaks).toHaveBeenCalledWith({
            bufferId: 'buf-1',
            numBins: 100,
            startSample: 24_000,
            endSample: 72_000,
        });
    });

    it('should not read waveform peaks when the cached audio buffer is missing', () => {
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        drawClip(mockCtx, create_audio_clip({ audioBufferId: 'missing-buffer' }), create_test_model(), 0, 40);

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'missing-buffer' });
        expect(mocks.getCachedAudioBufferWaveformPeaks).not.toHaveBeenCalled();
    });
});
