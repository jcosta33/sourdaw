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

const create_test_audio_buffer = (sampleRate = 48_000, length = 96_000): AudioBuffer => {
    const channel_data = new Float32Array(length);
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
    stretchMode: 'timestretch',
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

    describe('inline MIDI editing', () => {
        const inlineClip = (overrides: Partial<ClipRenderModel>): ClipRenderModel => ({
            id: 'c1',
            startBeat: 8,
            endBeat: 12,
            name: 'Inline',
            type: 'midi',
            color: '#000',
            muted: false,
            midiNotes: [],
            isInlineEditing: true,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            ...overrides,
        });

        it('places a note of a clip that starts at beat 8 by its offset and clip-relative beat', () => {
            const clip = inlineClip({
                midiOffsetBeats: 1,
                midiNotes: [{ id: 'n1', startBeat: 1.5, duration: 1, pitch: 60 }],
            });

            drawClip(mockCtx, clip, create_test_model(), 0, 80);

            // x = 8 * 25 = 200, w = 4 * 25 = 100; relStart = 1.5 - 1 = 0.5 beat => 200 + 0.5 / 4 * 100.
            const noteCall = mockCtx.roundRect.mock.calls.find((args: number[]) => args[0] === 212.5);
            expect(noteCall?.[2]).toBe(25);
        });

        it('draws the pitch grid for an inline clip with no notes', () => {
            drawClip(mockCtx, inlineClip({}), create_test_model(), 0, 80);

            // The grid backdrop covers the note area (padding 2 inside an 80px track) and every row gets a line.
            expect(mockCtx.fillRect).toHaveBeenCalledWith(200, 2, 100, 76);
            expect(mockCtx.moveTo.mock.calls.filter((args: number[]) => args[0] === 200 && args[1] >= 2)).toHaveLength(
                14
            );
        });

        it('draws no pitch grid for a non-inline clip with no notes', () => {
            drawClip(mockCtx, inlineClip({ isInlineEditing: false }), create_test_model(), 0, 80);

            expect(mockCtx.fillRect).not.toHaveBeenCalledWith(200, 2, 100, 76);
        });

        it('keeps the preview note placement for a non-inline clip', () => {
            const clip = inlineClip({
                isInlineEditing: false,
                midiOffsetBeats: 1,
                midiNotes: [{ id: 'n1', startBeat: 1.5, duration: 1, pitch: 60 }],
            });

            drawClip(mockCtx, clip, create_test_model(), 0, 80);

            // Preview area starts under the 18px header: height 80 - 2 - 18 = 60, split in two rows for a single pitch,
            // and the note takes the lower one: y = 18 + 60 - 60 / 2 = 48.
            const noteCall = mockCtx.fillRect.mock.calls.find((args: number[]) => args[0] === 212.5);
            expect(noteCall).toEqual([212.5, 48, 25, 30]);
        });
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
        const buffer = create_test_audio_buffer(48_000, 480_000);
        mocks.getCachedAudioBuffer.mockReturnValue(buffer);
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array([0.1, 0.5, 0.25]));

        drawClip(mockCtx, create_audio_clip(), create_test_model(), 0, 40);

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(mocks.getCachedAudioBufferWaveformPeaks).toHaveBeenCalledWith({
            bufferId: 'buf-1',
            numBins: 100,
            startSample: 24_000,
            endSample: 216_000,
        });
    });

    it('requests the clip-start-tempo source window when the map tempo differs from base tempo', () => {
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer(48_000, 480_000));
        drawClip(
            mockCtx,
            create_audio_clip({ clipStartTempo: 90 }),
            create_test_model({
                sourceTimeline: { secondsAtBeat: (beat) => (beat * 2) / 3, beatAtSeconds: (seconds) => seconds * 1.5 },
            }),
            0,
            40
        );
        expect(mocks.getCachedAudioBufferWaveformPeaks).toHaveBeenCalledWith(
            expect.objectContaining({ startSample: 32_000, endSample: 288_000 })
        );
    });

    it('requests canonical PCM and places its bins through the captured tempo map', () => {
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer(48_000, 480_000));
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array([0.1, 0.5, 0.25]));
        const clip = create_audio_clip({
            startBeat: 4,
            endBeat: 8,
            audioOffsetBeats: 12,
            audioOffsetSeconds: 0,
            clipStartTempo: 60,
        });
        const model = create_test_model({
            sourceTimeline: {
                secondsAtBeat: (beat) => {
                    if (beat <= 4) {
                        return beat / 2;
                    }
                    if (beat <= 6) {
                        return 2 + beat - 4;
                    }
                    return 4 + (beat - 6) / 2;
                },
                beatAtSeconds: (seconds) => {
                    if (seconds <= 2) {
                        return seconds * 2;
                    }
                    if (seconds <= 4) {
                        return 4 + seconds - 2;
                    }
                    return 6 + (seconds - 4) * 2;
                },
            },
        });

        drawClip(mockCtx, clip, model, 0, 40);

        expect(mocks.getCachedAudioBufferWaveformPeaks).toHaveBeenCalledWith({
            bufferId: 'buf-1',
            numBins: 100,
            startSample: 0,
            endSample: 288000,
        });
        const waveform = mockCtx.lineTo.mock.calls.filter((args: number[]) => args[1] !== 2.5);
        expect(waveform.slice(0, 3).map((point: number[]) => point[0])).toEqual([102, 127, 152]);
    });

    it('should not read waveform peaks when the cached audio buffer is missing', () => {
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        drawClip(mockCtx, create_audio_clip({ audioBufferId: 'missing-buffer' }), create_test_model(), 0, 40);

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'missing-buffer' });
        expect(mocks.getCachedAudioBufferWaveformPeaks).not.toHaveBeenCalled();
    });

    it('draws the pre-roll as leading silence and shortens the material for a negative offset (#2519)', () => {
        // The issue's worked example: a 2-second clip (4 beats at 120 BPM) at
        // audioOffsetBeats = -1. Heard, per the scheduler's pre-roll: 0.5 s of
        // silence, then the file's first 1.5 s. Drawn: the same thing — 1 beat
        // (25 px) of leading silence before the waveform, which then shows
        // source samples 0..72_000 (1.5 s at 48 kHz), not the full 96_000 the
        // clip width would hold. Pre-fix, the clamp hid the pre-roll entirely
        // and the drawn span covered material that never sounds.
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer());
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array([0.5]));

        // Clip beats 2..6 at 25 px/beat → x = 50, w = 100.
        const clip = create_audio_clip({ audioOffsetBeats: -1, stretchRatio: 1 });
        drawClip(mockCtx, clip, create_test_model(), 0, 40);

        expect(mocks.getCachedAudioBufferWaveformPeaks).toHaveBeenCalledWith({
            bufferId: 'buf-1',
            numBins: 75, // 100 px minus the 25 px pre-roll
            startSample: 0,
            endSample: 72_000,
        });

        // The waveform polygon starts after the pre-roll. The only other
        // lineTo drawClip issues here is the top-edge highlight at y = 2.5,
        // so these two calls are the up- and down-sweep of the one bin.
        const waveformLineTos = mockCtx.lineTo.mock.calls.filter((args: number[]) => args[1] !== 2.5);
        expect(waveformLineTos).toHaveLength(2);
        for (const [xCoord] of waveformLineTos) {
            expect(xCoord).toBeCloseTo(50 + 2 + 25); // x + padding + pre-roll
        }
    });

    it('draws no waveform when the pre-roll swallows the whole clip', () => {
        // Offset -5 beats against a 4-beat clip: the scheduler's playDuration
        // is <= 0 and it starts no source, so there is no audible span to draw.
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer());

        const clip = create_audio_clip({ audioOffsetBeats: -5, stretchRatio: 1 });
        drawClip(mockCtx, clip, create_test_model(), 0, 40);

        expect(mocks.getCachedAudioBufferWaveformPeaks).not.toHaveBeenCalled();
    });

    it('keeps a zero offset drawing the full clip width with no leading silence', () => {
        // Anchor for the non-negative path: identical window and geometry to
        // the pre-fix renderer (offset 0 → start 0, full 2 s of material,
        // waveform starting at the clip's left inset).
        mocks.getCachedAudioBuffer.mockReturnValue(create_test_audio_buffer());
        mocks.getCachedAudioBufferWaveformPeaks.mockReturnValue(new Float32Array([0.5]));

        const clip = create_audio_clip({ audioOffsetBeats: 0, stretchRatio: 1 });
        drawClip(mockCtx, clip, create_test_model(), 0, 40);

        expect(mocks.getCachedAudioBufferWaveformPeaks).toHaveBeenCalledWith({
            bufferId: 'buf-1',
            numBins: 100,
            startSample: 0,
            endSample: 96_000,
        });

        // The waveform starts at the clip's left inset: no leading gap.
        const firstWaveformLineTo = mockCtx.lineTo.mock.calls.find((args: number[]) => args[1] !== 2.5);
        expect(firstWaveformLineTo![0]).toBeCloseTo(50 + 2); // x + padding
    });
});
