import { describe, expect, it, vi } from 'vitest';

import { renderTempoTimeline } from '../renderTempoTimeline';

/** A map of `tempo` up to `changeBeat` and `nextTempo` after it. */
function twoTempoMap(tempo: number, changeBeat: number, nextTempo: number) {
    const changeSeconds = (changeBeat * 60) / tempo;
    return {
        secondsAtBeat: (beat: number) =>
            beat <= changeBeat ? (beat * 60) / tempo : changeSeconds + ((beat - changeBeat) * 60) / nextTempo,
        tempoAtBeat: (beat: number) => (beat < changeBeat ? tempo : nextTempo),
    };
}

describe('renderTempoTimeline', () => {
    it.each([
        { name: 'a drop', map: twoTempoMap(120, 10, 60), beats: [3, 9.5, 10, 12, 15.5] },
        { name: 'a rise', map: twoTempoMap(60, 10, 140), beats: [3, 9.5, 10, 12, 15.5] },
    ])('inverts the render’s placement across $name', ({ map, beats }) => {
        const timeline = renderTempoTimeline(map.secondsAtBeat, map.tempoAtBeat);

        for (const beat of beats) {
            expect(timeline.beatAtSeconds(map.secondsAtBeat(beat))).toBeCloseTo(beat, 9);
        }
    });

    it('inverts placement after a tempo excursion shorter than the constant-span tolerance', () => {
        const secondsAtBeat = (beat: number) => {
            if (beat <= 0.0001) {
                return beat / 2;
            }
            if (beat <= 0.0002) {
                return 0.00005 + (beat - 0.0001) / 4;
            }
            return beat / 2 - 0.000025;
        };
        const tempoAtBeat = (beat: number) => (beat >= 0.0001 && beat < 0.0002 ? 240 : 120);
        const timeline = renderTempoTimeline(secondsAtBeat, tempoAtBeat);

        expect(timeline.beatAtSeconds(0.4)).toBeCloseTo(0.80005, 12);
        expect(secondsAtBeat(timeline.beatAtSeconds(0.4))).toBeCloseTo(0.4, 12);
    });

    it('reads a whole-sample placement back to within a sample', () => {
        const sampleRate = 48_000;
        const map = twoTempoMap(120, 10, 60);
        const onSamples = (beat: number) => Math.round(map.secondsAtBeat(beat) * sampleRate) / sampleRate;
        const timeline = renderTempoTimeline(onSamples, map.tempoAtBeat);

        expect(Math.abs(timeline.beatAtSeconds(map.secondsAtBeat(12.3)) - 12.3)).toBeLessThan(
            (2 * 60) / (60 * sampleRate)
        );
    });

    it.each([null, 48000])('inverts a short instant-tempo excursion on sample grid %s', (sampleRate) => {
        const secondsAtBeat = (beat: number) => {
            let seconds = beat / 3;
            if (beat > 0.5) {
                seconds = 1 / 3 + (beat - 0.5) / 3;
            } else if (beat > 0.25) {
                seconds = 1 / 12 + beat - 0.25;
            }
            return sampleRate === null ? seconds : Math.round(seconds * sampleRate) / sampleRate;
        };
        const timeline = renderTempoTimeline(secondsAtBeat, (beat) => (beat >= 0.25 && beat < 0.5 ? 60 : 180));
        for (const beat of [0.02, 0.2499, 0.34, 0.4999, 0.5, 0.75, 2]) {
            const seconds = secondsAtBeat(beat);
            const inverted = timeline.beatAtSeconds(seconds);
            if (sampleRate === null) {
                expect(inverted).toBeCloseTo(beat, 10);
            } else {
                expect(Math.round(secondsAtBeat(inverted) * sampleRate)).toBe(Math.round(seconds * sampleRate));
                expect(Math.abs(inverted - beat)).toBeLessThan(3 / sampleRate);
            }
        }
    });

    it('inverts a linear ramp, its constant tail and negative preroll', () => {
        // 120 -> 240 BPM over [0,4], integrating 60 / (120 + 30*beat).
        const secondsAtBeat = (beat: number) => {
            if (beat <= 0) {
                return beat / 2;
            }
            if (beat <= 4) {
                return 2 * Math.log(1 + beat / 4);
            }
            return 2 * Math.log(2) + (beat - 4) / 4;
        };
        const timeline = renderTempoTimeline(secondsAtBeat, (beat) => Math.max(120, Math.min(240, 120 + 30 * beat)));
        for (const beat of [-128.5, -0.125, 0, 0.25, 1, 3.5, 4, 4.25, 12]) {
            expect(timeline.beatAtSeconds(secondsAtBeat(beat))).toBeCloseTo(beat, 10);
        }
    });

    it.each([10.25, -10.25])('keeps an off-grid target of %s frames on available whole samples', (frames) => {
        const sampleRate = 48000;
        const secondsAtBeat = (beat: number) => Math.round(beat * sampleRate) / sampleRate;
        const timeline = renderTempoTimeline(secondsAtBeat, () => 60);
        const target = frames / sampleRate;
        const placement = secondsAtBeat(timeline.beatAtSeconds(target));
        expect(Math.round(placement * sampleRate)).toBe(Math.floor(frames));
        expect(placement).toBeLessThan(target);
        expect(target - placement).toBeLessThan(1 / sampleRate);
    });

    it.each([NaN, Infinity, -Infinity])('refuses non-finite target %s', (seconds) => {
        const reader = vi.fn((beat: number) => beat);
        expect(() => renderTempoTimeline(reader, () => 60).beatAtSeconds(seconds)).toThrow(RangeError);
        expect(reader).not.toHaveBeenCalled();
    });

    it.each([NaN, Infinity, -Infinity])('refuses non-finite placement %s', (seconds) => {
        expect(() =>
            renderTempoTimeline(
                () => seconds,
                () => 60
            ).beatAtSeconds(1)
        ).toThrow(RangeError);
    });

    it('refuses a non-finite placement inside the bracket', () => {
        const reader = (beat: number) => (beat === 0.5 ? NaN : beat);
        expect(() => renderTempoTimeline(reader, () => 60).beatAtSeconds(0.25)).toThrow(RangeError);
    });

    it('refuses a decreasing placement rather than returning a false inverse', () => {
        expect(() =>
            renderTempoTimeline(
                (beat) => -beat,
                () => 60
            ).beatAtSeconds(1)
        ).toThrow(RangeError);
    });

    it('bounds a reader that cannot bracket the target by the finite number range', () => {
        const reader = vi.fn(() => 0);
        expect(() => renderTempoTimeline(reader, () => 60).beatAtSeconds(1)).toThrow(RangeError);
        expect(reader.mock.calls.length).toBeLessThan(1100);
    });

    it('continues making representable progress for a very small finite target', () => {
        const reader = vi.fn((beat: number) => beat);
        expect(renderTempoTimeline(reader, () => 60).beatAtSeconds(1e-250)).toBe(1e-250);
        expect(reader.mock.calls.length).toBeLessThan(1100);
    });
});
