import { describe, expect, it } from 'vitest';

import { computeAudioWaveformDrawSpan } from '../audioWaveformSpan';

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
});
