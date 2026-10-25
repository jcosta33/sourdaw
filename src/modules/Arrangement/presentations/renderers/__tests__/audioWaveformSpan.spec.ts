import { describe, expect, it } from 'vitest';

import type { ClipRenderModel, TimelineRenderModel } from '../../../models/TimelineRenderModel';
import {
    computeAudioWaveformDrawSpan,
    getAudioWaveformOccurrences,
    getAudioWaveformPeakPositions,
} from '../audioWaveformSpan';

const secondsPerBeatAt120Bpm = 60 / 120;
const sampleRate48k = 48_000;

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
                    secondsAtBeat: (beat) => (beat <= 4 ? beat / 2 : beat <= 6 ? 2 + beat - 4 : 4 + (beat - 6) / 2),
                    beatAtSeconds: (seconds) =>
                        seconds <= 2 ? seconds * 2 : seconds <= 4 ? 4 + seconds - 2 : 6 + (seconds - 4) * 2,
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
