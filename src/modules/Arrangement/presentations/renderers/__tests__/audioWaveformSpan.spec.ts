import { describe, expect, it } from 'vitest';

import {
    cacheAudioBuffer,
    clearCachedAudioBuffers,
    getCachedAudioBufferWaveformPeaks,
} from '#/modules/AudioEngine/useCases';
import { createSamplePositionProjector, secondsBetweenBeats } from '#/modules/Transport/useCases';

import {
    computeAudioWaveformDrawSpan,
    getAudioWaveformOccurrences,
    getAudioWaveformPeakPositions,
} from '../audioWaveformSpan';

import type { ClipRenderModel, TimelineRenderModel } from '../../../models/TimelineRenderModel';

const secondsPerBeatAt120Bpm = 60 / 120;
const sampleRate48k = 48_000;

function capturedTimeline(changes: Parameters<typeof secondsBetweenBeats>[0]) {
    const captured = structuredClone([...changes]);
    const project = createSamplePositionProjector({ transport: { tempo: 120 }, tempoMap: { changes: captured } });
    return {
        secondsAtBeat: (beat: number) => secondsBetweenBeats(captured, 0, beat, 120),
        beatAtSeconds: (seconds: number) => project({ samples: seconds, sampleRate: 1 }),
    };
}

describe('waveform exclusive source endpoints', () => {
    it('keeps an exact PCM boundary after adding a non-dyadic source entry', () => {
        const span = computeAudioWaveformDrawSpan({
            offsetBeats: 1,
            stretchRatio: 2,
            clipStartBeat: 2,
            clipBeats: 4,
            secondsPerBeat: 60 / 90,
            sampleRate: sampleRate48k,
        });
        expect(span.startSample).toBe(32_000);
        expect(span.endSample).toBe(288_000);
    });

    it('includes a genuinely fractional final PCM cell', () => {
        const span = computeAudioWaveformDrawSpan({
            offsetBeats: 0,
            offsetSeconds: 0,
            stretchRatio: 1,
            clipBeats: 288_000.25 / sampleRate48k,
            secondsPerBeat: 1,
            sampleRate: sampleRate48k,
        });
        expect(span.endSample).toBe(288_001);
    });

    const clip: ClipRenderModel = {
        id: 'source',
        startBeat: 0,
        endBeat: 1,
        type: 'audio',
        name: 'Source',
        color: '',
        muted: false,
        midiNotes: [],
        fadeInBeats: 0,
        fadeOutBeats: 0,
        audioOffsetBeats: -0.2,
        audioOffsetSeconds: -0.1,
    };
    const model: TimelineRenderModel = {
        dataDirty: true,
        tracks: [],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        playheadPosition: 0,
        viewportStartBeat: 0,
        viewportEndBeat: 8,
        beatsPerPixel: 0.01,
        pixelsPerBeat: 100,
        trackHeight: 80,
        scrollY: 0,
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
    };
    it('preserves the forward-owned two-row exclusive endpoint through the actual tempo inverse', () => {
        const changes = [
            { id: 'base', beat: 0, tempo: 120, curve: 'instant' as const },
            { id: 'faster', beat: 0.25, tempo: 240, curve: 'instant' as const },
        ];
        const timeline = capturedTimeline(changes);
        const forward = computeAudioWaveformDrawSpan({
            offsetBeats: -0.2,
            offsetSeconds: -0.1,
            stretchRatio: 1,
            clipBeats: 1,
            secondsPerBeat: 0.5,
            sampleRate: sampleRate48k,
            timeline,
            bufferLengthSamples: sampleRate48k,
        });
        const inverseEndBeat = timeline.beatAtSeconds(forward.soundStartSongSeconds + forward.sourceEndSeconds);
        const mappedEndSeconds = timeline.secondsAtBeat(inverseEndBeat) - forward.soundStartSongSeconds;
        const occurrences = getAudioWaveformOccurrences({
            clip,
            model: { ...model, sourceTimeline: timeline },
            sampleRate: sampleRate48k,
            bufferLength: sampleRate48k,
            maxBins: 600,
        });
        expect(timeline.secondsAtBeat(1)).toBe(0.3125);
        expect(forward.sourceEndSeconds).toBe(0.2125);
        expect(forward.endSample).toBe(10_200);
        expect(occurrences).toHaveLength(1);
        expect(occurrences[0]!.span.startSample).toBe(0);
        expect(
            occurrences[0]!.span.endSample,
            JSON.stringify({
                forward,
                inverseEndBeat,
                mappedEndSeconds,
                mappedEndFrames: mappedEndSeconds * sampleRate48k,
            })
        ).toBe(10_200);
    });

    it.each([
        {
            label: 'original three-row endpoint',
            thirdRow: true,
            viewportStart: 0,
            viewportEnd: 8,
            bufferLength: 48_000,
            ratio: 1,
            samples: [0, 16_800],
        },
        {
            label: 'short source buffer',
            thirdRow: false,
            viewportStart: 0,
            viewportEnd: 8,
            bufferLength: 5_100,
            ratio: 1,
            samples: [0, 5_100],
        },
        {
            label: 'viewport at both ends',
            thirdRow: false,
            viewportStart: 0.5,
            viewportEnd: 0.75,
            bufferLength: 48_000,
            ratio: 1,
            samples: [4_200, 7_200],
        },
        {
            label: 'fractional exclusive end',
            thirdRow: false,
            viewportStart: 0,
            viewportEnd: 0.99999,
            bufferLength: 48_000,
            ratio: 1,
            samples: [0, 10_200],
        },
        {
            label: 'half source rate',
            thirdRow: false,
            viewportStart: 0,
            viewportEnd: 8,
            bufferLength: 48_000,
            ratio: 0.5,
            samples: [0, 2_700],
        },
        {
            label: 'double source rate',
            thirdRow: false,
            viewportStart: 0,
            viewportEnd: 8,
            bufferLength: 48_000,
            ratio: 2,
            samples: [0, 25_200],
        },
    ])(
        'retains exact clipping for $label',
        ({ thirdRow, viewportStart, viewportEnd, bufferLength, ratio, samples }) => {
            const changes = [
                { id: 'base', beat: 0, tempo: 120, curve: 'instant' as const },
                { id: 'faster', beat: 0.25, tempo: 240, curve: 'instant' as const },
            ];
            if (thirdRow) {
                changes.push({ id: 'slower', beat: 0.45, tempo: 120, curve: 'instant' as const });
            }
            const occurrences = getAudioWaveformOccurrences({
                clip: { ...clip, stretchMode: 'timestretch', stretchRatio: ratio },
                model: {
                    ...model,
                    viewportStartBeat: viewportStart,
                    viewportEndBeat: viewportEnd,
                    sourceTimeline: capturedTimeline(changes),
                },
                sampleRate: sampleRate48k,
                bufferLength,
                maxBins: 600,
            });
            expect(occurrences.map(({ span }) => [span.startSample, span.endSample])).toEqual([samples]);
        }
    );

    it('retains the seven-frame integer buffer cap at high zoom', () => {
        const timeline = capturedTimeline([
            { id: 'base', beat: 0, tempo: 120, curve: 'instant' },
            { id: 'faster', beat: 0.25, tempo: 240, curve: 'instant' },
        ]);
        const span = computeAudioWaveformDrawSpan({
            offsetBeats: -0.2,
            offsetSeconds: -0.1,
            stretchRatio: 1,
            clipBeats: 1,
            secondsPerBeat: 0.5,
            sampleRate: sampleRate48k,
            timeline,
            bufferLengthSamples: 7,
        });
        expect(span.sourceEndSeconds * sampleRate48k).toBeGreaterThan(7);
        expect(span.endSample).toBe(7);
        const occurrences = getAudioWaveformOccurrences({
            clip,
            model: {
                ...model,
                sourceTimeline: timeline,
                pixelsPerBeat: sampleRate48k,
                beatsPerPixel: 1 / sampleRate48k,
            },
            sampleRate: sampleRate48k,
            bufferLength: 7,
            maxBins: 600,
        });
        expect(occurrences.map(({ span }) => [span.startSample, span.endSample])).toEqual([[0, 7]]);
    });

    it.each([
        { label: 'fractional half-rate end', ratio: 0.5, thirdRow: false, last: 2_699, next: 2_700 },
        { label: 'integer original three-row end', ratio: 1, thirdRow: true, last: 16_799, next: 16_800 },
    ])('includes the last PCM cell and excludes the next at the $label', ({ ratio, thirdRow, last, next }) => {
        const pcm = new Float32Array(sampleRate48k);
        pcm[last] = 0.5;
        pcm[next] = 1;
        const buffer: AudioBuffer = {
            length: pcm.length,
            sampleRate: sampleRate48k,
            duration: 1,
            numberOfChannels: 1,
            getChannelData: () => pcm,
            copyFromChannel: (destination, _channel, start = 0) =>
                destination.set(pcm.subarray(start, start + destination.length)),
            copyToChannel: (source, _channel, start = 0) => pcm.set(source, start),
        };
        const changes = [
            { id: 'base', beat: 0, tempo: 120, curve: 'instant' as const },
            { id: 'faster', beat: 0.25, tempo: 240, curve: 'instant' as const },
        ];
        if (thirdRow) {
            changes.push({ id: 'slower', beat: 0.45, tempo: 120, curve: 'instant' as const });
        }
        const [occurrence] = getAudioWaveformOccurrences({
            clip: { ...clip, stretchMode: 'timestretch', stretchRatio: ratio },
            model: { ...model, sourceTimeline: capturedTimeline(changes) },
            sampleRate: sampleRate48k,
            bufferLength: pcm.length,
            maxBins: 600,
        });
        expect(occurrence).toBeDefined();
        if (!occurrence) {
            throw new Error('Expected the audible waveform occurrence');
        }
        const bufferId = cacheAudioBuffer({ buffer });
        try {
            const peaks = getCachedAudioBufferWaveformPeaks({
                bufferId,
                numBins: next,
                startSample: occurrence.span.startSample,
                endSample: occurrence.span.endSample,
            });
            expect(occurrence.span.endSample).toBe(next);
            expect(peaks[last]).toBe(0.5);
            expect(Math.max(...peaks)).toBe(0.5);
        } finally {
            clearCachedAudioBuffers();
        }
    });
});

describe('computeAudioWaveformDrawSpan', () => {
    it('places every source part on its own original beat span after an interior loop cut', () => {
        const clip: ClipRenderModel = {
            id: 'cut',
            startBeat: 2,
            endBeat: 9,
            name: 'Cut',
            color: '',
            type: 'audio',
            muted: false,
            midiNotes: [],
            fadeInBeats: 0,
            fadeOutBeats: 0,
            audioOffsetSeconds: 1.5,
            audioLoopStartSeconds: 0,
            audioLoopPassEntrySeconds: 0.5,
            audioLoopPassOriginBeat: 1,
            loopOriginBeat: 0,
            loopEnabled: true,
            loopLength: 4,
            stretchMode: 'timestretch',
            stretchRatio: 2,
        };
        const model: TimelineRenderModel = {
            dataDirty: true,
            tracks: [],
            selectedTrackId: null,
            selectedClipId: null,
            selectedClipIds: [],
            playheadPosition: 0,
            viewportStartBeat: 0,
            viewportEndBeat: 12,
            beatsPerPixel: 0.01,
            pixelsPerBeat: 100,
            trackHeight: 80,
            scrollY: 0,
            tempo: 120,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        };
        const occurrences = getAudioWaveformOccurrences({
            clip,
            model,
            sampleRate: sampleRate48k,
            bufferLength: sampleRate48k * 10,
            maxBins: 1000,
        });
        expect(occurrences.map(({ span }) => [span.startSample, span.endSample])).toEqual([
            [72000, 168000],
            [0, 48000],
            [24000, 72000],
            [72000, 168000],
            [0, 48000],
        ]);
        expect(
            occurrences.map((occurrence) => [
                ...getAudioWaveformPeakPositions({ clip, model, occurrence, binCount: 1 }),
            ])
        ).toEqual([
            [200, 400],
            [400, 500],
            [500, 600],
            [600, 800],
            [800, 900],
        ]);
    });

    it.each([
        { offsetSeconds: 0, leading: 0, endSample: 288000 },
        { offsetSeconds: -1, leading: 0.5, endSample: 240000 },
    ])(
        'draws canonical source $offsetSeconds through the internal tempo map',
        ({ offsetSeconds, leading, endSample }) => {
            const span = computeAudioWaveformDrawSpan({
                offsetBeats: 12,
                offsetSeconds,
                stretchRatio: 2,
                clipBeats: 4,
                secondsPerBeat: 1,
                sampleRate: sampleRate48k,
                clipStartBeat: 4,
                timeline: {
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

            expect(span.startSample).toBe(0);
            expect(span.endSample).toBe(endSample);
            expect(span.leadingSilenceBeats).toBe(leading);
            expect(span.audibleTimelineBeats).toBe(4 - leading);
        }
    );

    it('should show B * r source beats over B destination beats at ratio 0.5', () => {
        // Fit-to-beats stores ratio 0.5 when stretching 4 beats of material to
        // 8 destination beats. The scheduler consumes T * stretchRatio of
        // source over destination time T, so 8 destination beats draw 4
        // source beats — 96_000 samples at 120 BPM / 48 kHz.
        const span = computeAudioWaveformDrawSpan({
            offsetBeats: 0,
            stretchRatio: 0.5,
            clipBeats: 8,
            secondsPerBeat: secondsPerBeatAt120Bpm,
            sampleRate: sampleRate48k,
        });

        expect(span.startSample).toBe(0);
        expect(span.endSample).toBe(96_000);
        expect(span.leadingSilenceBeats).toBe(0);
        expect(span.audibleTimelineBeats).toBe(8);
    });

    it('should show B * r source beats over B destination beats at ratio 2', () => {
        const span = computeAudioWaveformDrawSpan({
            offsetBeats: 0,
            stretchRatio: 2,
            clipBeats: 4,
            secondsPerBeat: secondsPerBeatAt120Bpm,
            sampleRate: sampleRate48k,
        });

        expect(span.startSample).toBe(0);
        expect(span.endSample).toBe(192_000);
        expect(span.leadingSilenceBeats).toBe(0);
        expect(span.audibleTimelineBeats).toBe(4);
    });

    it('should window offset-1 ratio-2 material at samples 24_000..216_000', () => {
        // Issue #2218 worked numbers: 120 BPM, 48 kHz, 4 destination beats,
        // offset 1 beat, r=2. The scheduler consumes 8 source beats from that
        // offset: 24_000 + 8 * 0.5 * 48_000 = 216_000.
        const span = computeAudioWaveformDrawSpan({
            offsetBeats: 1,
            stretchRatio: 2,
            clipBeats: 4,
            secondsPerBeat: secondsPerBeatAt120Bpm,
            sampleRate: sampleRate48k,
        });

        expect(span.startSample).toBe(24_000);
        expect(span.endSample).toBe(216_000);
        expect(span.leadingSilenceBeats).toBe(0);
        expect(span.audibleTimelineBeats).toBe(4);
    });

    it('should keep pre-roll as max(0, -offset) / ratio', () => {
        // Scheduler: preRollSeconds = max(0, -offsetSeconds) / stretchRatio.
        // Ratio 2 halves the leading silence; consumption must not invert that.
        const span = computeAudioWaveformDrawSpan({
            offsetBeats: -1,
            stretchRatio: 2,
            clipBeats: 4,
            secondsPerBeat: secondsPerBeatAt120Bpm,
            sampleRate: sampleRate48k,
        });

        expect(span.leadingSilenceBeats).toBe(0.5);
        expect(span.audibleTimelineBeats).toBe(3.5);
        expect(span.startSample).toBe(0);
        expect(span.endSample).toBe(168_000);
    });
});

describe('getAudioWaveformOccurrences — explicit audible programme', () => {
    const model: TimelineRenderModel = {
        dataDirty: true,
        tracks: [],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        playheadPosition: 0,
        viewportStartBeat: 0,
        viewportEndBeat: 8,
        beatsPerPixel: 0.01,
        pixelsPerBeat: 100,
        trackHeight: 80,
        scrollY: 0,
        tempo: 120,
        timeSignatureNumerator: 4,
        timeSignatureDenominator: 4,
    };
    const clip: ClipRenderModel = {
        id: 'comped',
        startBeat: 0,
        endBeat: 8,
        name: 'Comped',
        color: '',
        type: 'audio',
        muted: false,
        midiNotes: [],
        audioBufferId: 'recording',
        audioOffsetSeconds: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
    };

    function displayedWindows(displayedClip: ClipRenderModel, timeline?: TimelineRenderModel['sourceTimeline']) {
        const view = {
            ...model,
            viewportEndBeat: 64,
            pixelsPerBeat: 12,
            beatsPerPixel: 1 / 12,
            sourceTimeline: timeline,
        };
        return getAudioWaveformOccurrences({
            clip: displayedClip,
            model: view,
            sampleRate: sampleRate48k,
            bufferLength: sampleRate48k * 20,
            maxBins: 600,
        }).map((occurrence) => ({
            samples: [occurrence.span.startSample, occurrence.span.endSample],
            pixels: Array.from(
                getAudioWaveformPeakPositions({ clip: displayedClip, model: view, occurrence, binCount: 1 }),
                Math.round
            ),
        }));
    }

    it('draws the emitted selected loop programme across its internal tempo change', () => {
        const selected = {
            ...clip,
            audioProgramme: [
                {
                    ...clip,
                    startBeat: 1,
                    endBeat: 7,
                    audioOffsetSeconds: 2.5,
                    loopEnabled: true,
                    loopLength: 4,
                    stretchMode: 'timestretch' as const,
                    stretchRatio: 2,
                },
            ],
        };
        const timeline = capturedTimeline([
            { id: 'base', beat: 0, tempo: 120, curve: 'instant' },
            { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
        ]);
        expect(displayedWindows(selected, timeline)).toEqual([
            { samples: [120_000, 360_000], pixels: [12, 60] },
            { samples: [120_000, 312_000], pixels: [60, 84] },
        ]);
    });

    it('draws the emitted selected middle phrase and retained base gap tile', () => {
        const selected = {
            ...clip,
            audioProgramme: [
                { ...clip, startBeat: 0, endBeat: 2, audioOffsetSeconds: 0 },
                { ...clip, startBeat: 2, endBeat: 4, audioOffsetSeconds: 2 },
                { ...clip, startBeat: 4, endBeat: 6, audioOffsetSeconds: 10 },
                { ...clip, startBeat: 6, endBeat: 8, audioOffsetSeconds: 3 },
            ],
        };
        expect(displayedWindows(selected)).toEqual([
            { samples: [0, 48_000], pixels: [0, 24] },
            { samples: [96_000, 144_000], pixels: [24, 48] },
            { samples: [480_000, 528_000], pixels: [48, 72] },
            { samples: [144_000, 192_000], pixels: [72, 96] },
        ]);
    });

    it('leaves the rectangle silent outside the emitted finite placed pass', () => {
        const placed = { ...clip, audioProgramme: [{ ...clip, startBeat: 2, endBeat: 4, audioOffsetSeconds: 2 }] };
        expect(displayedWindows(placed)).toEqual([{ samples: [96_000, 144_000], pixels: [24, 48] }]);
    });

    it('draws canonical pre-roll and zero instead of the stale beat offset', () => {
        expect(displayedWindows({ ...clip, endBeat: 4, audioOffsetSeconds: -1, audioOffsetBeats: 99 })).toEqual([
            { samples: [0, 48_000], pixels: [24, 48] },
        ]);
        expect(
            displayedWindows({ ...clip, startBeat: 5, endBeat: 9, audioOffsetSeconds: 0, audioOffsetBeats: 99 })
        ).toEqual([{ samples: [0, 96_000], pixels: [60, 108] }]);
    });

    it('keeps the earlier immutable programme after the selected source changes', () => {
        const before = { ...clip, endBeat: 4, audioProgramme: [{ ...clip, endBeat: 4, audioOffsetSeconds: 1 }] };
        const after = { ...before, audioProgramme: [{ ...clip, endBeat: 4, audioOffsetSeconds: 2 }] };
        expect(displayedWindows(before)).toEqual([{ samples: [48_000, 144_000], pixels: [0, 48] }]);
        expect(displayedWindows(after)).toEqual([{ samples: [96_000, 192_000], pixels: [0, 48] }]);
        expect(displayedWindows(before)).toEqual([{ samples: [48_000, 144_000], pixels: [0, 48] }]);
    });

    it('draws the emitted drag-preview programme without moving the committed rectangle', () => {
        const committed = { ...clip, audioProgramme: [{ ...clip, startBeat: 2, endBeat: 4, audioOffsetSeconds: 2 }] };
        const preview = {
            ...committed,
            startBeat: 10,
            endBeat: 18,
            audioProgramme: [{ ...clip, startBeat: 12, endBeat: 14, audioOffsetSeconds: 2 }],
        };
        expect(displayedWindows(preview)).toEqual([{ samples: [96_000, 144_000], pixels: [144, 168] }]);
        expect([committed.startBeat, committed.endBeat]).toEqual([0, 8]);
    });

    it('does not fall back to the rectangle source when the programme is empty', () => {
        const silentClip = { ...clip, audioProgramme: [] };
        expect(
            getAudioWaveformOccurrences({
                clip: silentClip,
                model,
                sampleRate: sampleRate48k,
                bufferLength: sampleRate48k * 12,
                maxBins: 800,
            })
        ).toEqual([]);
    });

    it('draws only the chosen programme fragment inside the original rectangle', () => {
        const selectedClip = {
            ...clip,
            audioProgramme: [{ ...clip, startBeat: 2, endBeat: 4, audioOffsetSeconds: 4 }],
        };
        const occurrences = getAudioWaveformOccurrences({
            clip: selectedClip,
            model,
            sampleRate: sampleRate48k,
            bufferLength: sampleRate48k * 12,
            maxBins: 800,
        });
        expect(occurrences.map(({ span }) => [span.startSample, span.endSample])).toEqual([[192_000, 240_000]]);
        expect(
            Array.from(
                getAudioWaveformPeakPositions({
                    clip: selectedClip,
                    model,
                    occurrence: occurrences[0]!,
                    binCount: 1,
                })
            )
        ).toEqual([200, 400]);
    });
});
