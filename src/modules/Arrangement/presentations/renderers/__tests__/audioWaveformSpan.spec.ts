import { describe, expect, it } from 'vitest';

import {
    computeAudioWaveformDrawSpan,
    getAudioWaveformOccurrences,
    getAudioWaveformPeakPositions,
} from '../audioWaveformSpan';

import type { ClipRenderModel, TimelineRenderModel } from '../../../models/TimelineRenderModel';

const secondsPerBeatAt120Bpm = 60 / 120;
const sampleRate48k = 48_000;

describe('computeAudioWaveformDrawSpan', () => {
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

    it('ends signed canonical pre-roll at the inverse beat across an instant marker', () => {
        const span = computeAudioWaveformDrawSpan({
            offsetBeats: 4,
            offsetSeconds: -2,
            stretchRatio: 1,
            clipBeats: 8,
            secondsPerBeat: 0.5,
            sampleRate: 100,
            tempoChanges: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 2, tempo: 60, curve: 'instant' },
            ],
            baseTempo: 120,
        });

        expect(span.leadingSilenceBeats).toBeCloseTo(3, 10);
        expect(span.startSample).toBe(0);
        expect(span.endSample).toBe(500);
    });

    it('rebuilds cached loop windows when the map or preview geometry changes', () => {
        const clip: ClipRenderModel = {
            id: 'audio',
            startBeat: 0,
            endBeat: 8,
            name: 'Audio',
            color: '#000',
            type: 'audio',
            muted: false,
            midiNotes: [],
            audioBufferId: 'buffer',
            audioOffsetSeconds: 0,
            audioOffsetBeats: 2,
            stretchMode: 'off',
            stretchRatio: 2,
            loopEnabled: true,
            loopLength: 4,
            fadeInBeats: 0,
            fadeOutBeats: 0,
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
            beatsPerPixel: 0.04,
            pixelsPerBeat: 25,
            trackHeight: 40,
            scrollY: 0,
            tempo: 120,
            tempoChanges: [],
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        };
        const input = { clip, model, sampleRate: 100, bufferLength: 1000, maxBins: 600 };
        const first = getAudioWaveformOccurrences(input);
        expect(first).toHaveLength(2);
        expect(first[0]!.span.endSample).toBe(200);
        expect(first[1]!.span.endSample).toBe(200);
        expect(getAudioWaveformOccurrences(input)).toBe(first);

        model.tempoChanges = [{ id: 'slow', beat: 4, tempo: 60, curve: 'instant' }];
        const afterMap = getAudioWaveformOccurrences(input);
        expect(afterMap).not.toBe(first);
        expect(afterMap[1]!.span.endSample).toBe(400);

        clip.endBeat = 6;
        const afterPreview = getAudioWaveformOccurrences(input);
        expect(afterPreview).not.toBe(afterMap);
        expect(afterPreview[1]!.span.endSample).toBe(200);
    });

    it('requests only the visible tail of a long source window and places its bins there', () => {
        const clip: ClipRenderModel = {
            id: 'long-audio',
            startBeat: 0,
            endBeat: 100,
            name: 'Audio',
            color: '#000',
            type: 'audio',
            muted: false,
            midiNotes: [],
            audioBufferId: 'buffer',
            audioOffsetSeconds: 0,
            audioOffsetBeats: 20,
            stretchMode: 'off',
            stretchRatio: 2,
            loopEnabled: false,
            fadeInBeats: 0,
            fadeOutBeats: 0,
        };
        const model: TimelineRenderModel = {
            dataDirty: true,
            tracks: [],
            selectedTrackId: null,
            selectedClipId: null,
            selectedClipIds: [],
            playheadPosition: 0,
            viewportStartBeat: 98,
            viewportEndBeat: 100,
            beatsPerPixel: 0.04,
            pixelsPerBeat: 25,
            trackHeight: 40,
            scrollY: 0,
            tempo: 120,
            tempoChanges: [],
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        };

        const occurrences = getAudioWaveformOccurrences({
            clip,
            model,
            sampleRate: 100,
            bufferLength: 10_000,
            maxBins: 600,
        });

        expect(occurrences).toHaveLength(1);
        expect(occurrences[0]!.span.startSample).toBe(4_900);
        expect(occurrences[0]!.span.endSample).toBe(5_000);
        expect(occurrences[0]!.numBins).toBe(50);
        const positions = getAudioWaveformPeakPositions({ clip, model, occurrence: occurrences[0]!, binCount: 2 });
        expect(positions[0]).toBeCloseTo(0, 10);
        expect(positions[1]).toBeCloseTo(25, 10);
        expect(positions[2]).toBeCloseTo(50, 10);
    });
});
