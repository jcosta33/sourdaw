import { describe, expect, it } from 'vitest';

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

    it('reads a whole-sample placement back to within a sample', () => {
        const sampleRate = 48_000;
        const map = twoTempoMap(120, 10, 60);
        const onSamples = (beat: number) => Math.round(map.secondsAtBeat(beat) * sampleRate) / sampleRate;
        const timeline = renderTempoTimeline(onSamples, map.tempoAtBeat);

        expect(Math.abs(timeline.beatAtSeconds(map.secondsAtBeat(12.3)) - 12.3)).toBeLessThan(
            (2 * 60) / (60 * sampleRate)
        );
    });
    it('brackets a source end across a short 180 to 60 to 180 excursion', () => {
        const secondsAtBeat = (beat: number) => {
            if (beat <= 0.25) {
                return beat / 3;
            }
            if (beat <= 0.5) {
                return 0.25 / 3 + beat - 0.25;
            }
            return 0.25 / 3 + 0.25 + (beat - 0.5) / 3;
        };
        const tempoAtBeat = (beat: number) => (beat < 0.25 || beat >= 0.5 ? 180 : 60);
        const onSamples = (beat: number) => Math.round(secondsAtBeat(beat) * 48000) / 48000;
        const timeline = renderTempoTimeline(onSamples, tempoAtBeat);
        const target = 8320 / 48000;
        expect(Math.round(onSamples(timeline.beatAtSeconds(target)) * 48000)).toBe(8320);
        expect(timeline.beatAtSeconds(target)).toBeCloseTo(0.34, 4);
    });

    it.each([0, -1, -100, 1, 100])('preserves zero and signed placement at %s seconds', (seconds) => {
        const timeline = renderTempoTimeline(
            (beat) => beat / 2,
            () => 120
        );
        expect(timeline.beatAtSeconds(seconds)).toBe(seconds * 2);
    });
});
