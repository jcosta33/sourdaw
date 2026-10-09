import { beforeEach, describe, expect, it, vi } from 'vitest';

import { secondsBetweenBeats } from '../../../models/TempoMap';
import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { prepareTimelineMapTimeOperation } from '../prepareTimelineMapTimeOperation';
import { projectEngineTransportMaps } from '../projectEngineTransportMaps';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

const tempoChange = (beat: number, tempo: number, curve: 'instant' | 'linear' = 'instant') => ({
    id: `tempo-${beat}`,
    beat,
    tempo,
    curve,
});

describe('projectEngineTransportMaps', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [] });
        timeSignatureMapStore.set({ changes: [] });
    });

    it('opens both maps at zero even when the arrangement authored nothing there', () => {
        // The engine refuses a map whose first segment is not frame zero, so a
        // projection that echoed an empty arrangement would install nothing at
        // all — the tempo the engine follows would stay its own default.
        const maps = projectEngineTransportMaps();

        expect(maps.tempo[0]).toEqual({ startSeconds: 0, beatsPerMinute: 120 });
        expect(maps.timeSignature[0]).toEqual({ startSeconds: 0, numerator: 4, denominator: 4 });
    });

    it('places a tempo change at the second the arrangement reaches it, not at its beat', () => {
        tempoMapStore.set({ changes: [tempoChange(0, 120), tempoChange(8, 60)] });

        const maps = projectEngineTransportMaps();

        // Eight beats at 120 BPM is four seconds. A projection that sent beats
        // as seconds would put the change at eight.
        expect(maps.tempo).toEqual([
            { startSeconds: 0, beatsPerMinute: 120 },
            { startSeconds: 4, beatsPerMinute: 60 },
        ]);
    });

    it('samples a linear ramp instead of holding its opening tempo across it', () => {
        tempoMapStore.set({ changes: [tempoChange(0, 120, 'linear'), tempoChange(4, 240)] });

        const maps = projectEngineTransportMaps();

        // A step at the ramp's start would leave exactly two segments, both at
        // the endpoints, and the engine would run the whole ramp at 120.
        expect(maps.tempo.length).toBeGreaterThan(2);
        const rampTempos = maps.tempo.map((segment) => segment.beatsPerMinute);
        // The engine integrates each segment as span × BPM, so a segment
        // states the mean tempo of the span it opens rather than the ramp's
        // left endpoint (#4657): the opening segment's mean sits strictly
        // above the opening tempo, and only the final segment — whose span is
        // the rest of the arrangement — states an endpoint outright.
        expect(rampTempos[0]).toBeGreaterThan(120);
        expect(rampTempos.at(-1)).toBe(240);
        // Monotonic through the ramp, and strictly between the endpoints in the
        // middle: that is what makes it a ramp rather than two steps.
        expect(rampTempos.every((tempo, index) => index === 0 || tempo >= rampTempos[index - 1]!)).toBe(true);
        expect(rampTempos.some((tempo) => tempo > 120 && tempo < 240)).toBe(true);
    });

    it('keeps a dense ramp inside the engine segment ceiling', () => {
        // A four-thousand-beat ramp at quarter-beat resolution would be sixteen
        // thousand segments; the engine refuses the map outright above its
        // ceiling, so the sampling has to widen rather than the tail be cut.
        tempoMapStore.set({ changes: [tempoChange(0, 120, 'linear'), tempoChange(4000, 240)] });

        const maps = projectEngineTransportMaps();

        expect(maps.tempo.length).toBeLessThanOrEqual(4096);
        expect(maps.tempo.at(-1)?.beatsPerMinute).toBe(240);
    });

    it('fits exactly at the ceiling when the opening segment has to be prepended', () => {
        // Exactly `MAX_ENGINE_SEGMENTS` authored changes, none of them on beat
        // zero. Counting the cap before the prepend is the whole test: a
        // projection that filled to 4096 and *then* opened the map at zero
        // would hand the engine 4097 segments, hit OverCapacity, and install no
        // map at all — the arrangement would play at the engine's own default.
        tempoMapStore.set({ changes: Array.from({ length: 4096 }, (_, index) => tempoChange(index + 1, 100 + index)) });
        timeSignatureMapStore.set({
            changes: Array.from({ length: 4096 }, (_, index) => ({
                id: `ts-${index}`,
                beat: index + 1,
                numerator: 3,
                denominator: 4,
            })),
        });

        const maps = projectEngineTransportMaps();

        expect(maps.tempo).toHaveLength(4096);
        expect(maps.timeSignature).toHaveLength(4096);
        expect(maps.tempo[0]?.startSeconds).toBe(0);
        expect(maps.timeSignature[0]?.startSeconds).toBe(0);
    });

    it('thins a map denser than the ceiling across its whole span, rather than cutting its tail', () => {
        const lastBeat = 10_000;
        tempoMapStore.set({
            changes: Array.from({ length: lastBeat }, (_, index) => tempoChange(index + 1, 100 + (index % 50))),
        });

        const maps = projectEngineTransportMaps();

        expect(maps.tempo).toHaveLength(4096);
        // Truncation would end the map a quarter of the way in and leave the
        // rest of the arrangement on whichever tempo the cut landed on. Even
        // thinning keeps a segment near the end of the timeline.
        const lastSecond = maps.tempo.at(-1)?.startSeconds ?? 0;
        expect(lastSecond).toBeGreaterThan((lastBeat / 2) * (60 / 150));
    });

    it('ends a thinned map on the arrangement’s own last tempo change', () => {
        // Every interior entry the thinning drops is corrected a few beats
        // later by the next one it kept. The final change has nothing after it,
        // so dropping *that* one is permanent: the whole tail of the
        // arrangement renders at the previous kept tempo, for as long as the
        // arrangement runs. An even spread that stops short of the last index
        // does exactly that, on every over-capacity map.
        const changes = Array.from({ length: 9000 }, (_, index) => tempoChange(index + 1, 100 + (index % 40)));
        const authoredLast = changes.at(-1)!;
        tempoMapStore.set({ changes });

        const maps = projectEngineTransportMaps();
        const projectedLast = maps.tempo.at(-1);

        expect(projectedLast?.beatsPerMinute).toBe(authoredLast.tempo);
        // And at the second the arrangement actually reaches that beat, not
        // wherever the thinning happened to stop.
        expect(projectedLast?.startSeconds).toBeCloseTo(secondsBetweenBeats(changes, 0, authoredLast.beat, 120), 6);
    });

    it('reports the loop in seconds, and disabled when the transport is not looping', () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            tempo: 120,
            isLooping: false,
            loopStart: 4,
            loopEnd: 8,
        });

        expect(projectEngineTransportMaps().loopRegion).toEqual({
            enabled: false,
            startSeconds: 2,
            endSeconds: 4,
        });
    });

    it('opens one segment on a beat shared by an arrival and a governing change, stating the governing ramp', () => {
        // The ramp from beat 0 arrives at 140 on beat 4; the change that governs
        // from there ramps 160 -> 200 to beat 8. Both sit on one second, and the
        // engine refuses a map whose segments do not start on strictly
        // increasing frames.
        tempoMapStore.set({
            changes: [
                tempoChange(0, 100, 'linear'),
                { id: 'arrival', beat: 4, tempo: 140, curve: 'instant' },
                { id: 'governing', beat: 4, tempo: 160, curve: 'linear' },
                tempoChange(8, 200),
            ],
        });

        const { tempo } = projectEngineTransportMaps();

        const starts = tempo.map((segment) => segment.startSeconds);
        expect(starts.every((second, index) => index === 0 || second > starts[index - 1]!)).toBe(true);
        const cutSeconds = 6 * Math.log(1.4);
        const cutIndex = starts.findIndex((second) => Math.abs(second - cutSeconds) < 1e-9);
        expect(cutIndex).toBeGreaterThan(0);
        // Before the cut the ramp tops out at the arrival tempo.
        expect(tempo.slice(0, cutIndex).every((segment) => segment.beatsPerMinute <= 140)).toBe(true);
        // The governing 160 -> 200 ramp is sampled after the cut, so beats 4..8 are
        // several segments and not one step at the arrival.
        const afterCut = tempo.slice(cutIndex);
        expect(afterCut.length).toBeGreaterThan(4);
        // The segment opening at the cut states the mean of the ramp's first quarter-beat step.
        const firstStepMean = 2.5 / Math.log(162.5 / 160);
        expect(afterCut[0]!.beatsPerMinute).toBeCloseTo(firstStepMean, 6);
        const afterTempos = afterCut.map((segment) => segment.beatsPerMinute);
        expect(afterTempos.every((value, index) => index === 0 || value > afterTempos[index - 1]!)).toBe(true);
        expect(afterTempos.at(-1)).toBe(200);
    });

    it('projects a Delete Time over a non-dyadic span onto strictly increasing segment starts stating the change at the cut', () => {
        tempoMapStore.set({
            changes: [tempoChange(0, 100, 'linear'), tempoChange(3, 200)],
        });
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'delete', startBeat: 1 / 3, endBeat: 3 },
        });
        expect(transaction.status).toBe('ready');
        expect(transaction.apply()).toBe(true);

        const { tempo } = projectEngineTransportMaps();

        // The engine places a segment on a whole frame and refuses equal frames, so
        // a float step between two starts is no separation.
        const startFrames = tempo.map((segment) => Math.round(segment.startSeconds * 48_000));
        expect(startFrames.every((frame, index) => index === 0 || frame > startFrames[index - 1]!)).toBe(true);
        expect(tempo.at(-1)?.beatsPerMinute).toBe(200);
    });

    describe('a Delete Time projected onto strictly increasing engine frames', () => {
        const SAMPLE_RATE = 48_000;

        function deleteTime(startBeat: number, endBeat: number): void {
            const transaction = prepareTimelineMapTimeOperation({
                operation: { type: 'delete', startBeat, endBeat },
            });
            expect(transaction.status).toBe('ready');
            expect(transaction.apply()).toBe(true);
        }

        function frames(segments: readonly { startSeconds: number }[]): number[] {
            return segments.map((segment) => Math.round(segment.startSeconds * SAMPLE_RATE));
        }

        function expectStrictlyIncreasing(values: readonly number[]): void {
            expect(values.every((frame, index) => index === 0 || frame > values[index - 1]!)).toBe(true);
        }

        it('opens no ramp sample on the frame of the instant change it ramps toward', () => {
            tempoMapStore.set({ changes: [tempoChange(4, 100, 'linear'), tempoChange(5, 140)] });

            deleteTime(1 / 3, 4);

            const startFrames = frames(projectEngineTransportMaps().tempo);
            expect(startFrames.length).toBeGreaterThan(1);
            expectStrictlyIncreasing(startFrames);
        });

        it('opens no ramp sample a float step below the shifted change it ramps toward', () => {
            tempoMapStore.set({ changes: [tempoChange(0, 163, 'linear'), tempoChange(29 / 7, 54)] });

            deleteTime(0, 8 / 7);

            const startFrames = frames(projectEngineTransportMaps().tempo);
            expect(startFrames.length).toBeGreaterThan(1);
            expectStrictlyIncreasing(startFrames);
        });

        it('opens one meter segment where a carried meter sits a float step after beat zero', () => {
            timeSignatureMapStore.set({ changes: [{ id: 'ts-0', beat: 0, numerator: 2, denominator: 16 }] });
            tempoMapStore.set({ changes: [tempoChange(0, 84)] });

            deleteTime(0, 8 / 3);
            deleteTime(0, 19 / 3);

            const { timeSignature } = projectEngineTransportMaps();
            expectStrictlyIncreasing(frames(timeSignature));
            expect(timeSignature).toHaveLength(1);
            expect(timeSignature[0]?.startSeconds).toBe(0);
        });
    });

    it('opens one segment where two changes sit a float step apart', () => {
        tempoMapStore.set({
            changes: [
                tempoChange(0, 100),
                { id: 'arrival', beat: 1 / 3, tempo: 120, curve: 'instant' },
                { id: 'governing', beat: 1 / 3 + 2e-16, tempo: 200, curve: 'instant' },
            ],
        });

        const { tempo } = projectEngineTransportMaps();

        expect(tempo).toHaveLength(2);
        expect(tempo[0]?.beatsPerMinute).toBeCloseTo(100, 9);
        expect(tempo[1]?.beatsPerMinute).toBeCloseTo(200, 9);
    });

    it('integrates the meter map through the same tempo map as the tempo map itself', () => {
        tempoMapStore.set({ changes: [tempoChange(0, 120), tempoChange(4, 60)] });
        timeSignatureMapStore.set({
            changes: [
                { id: 'ts-0', beat: 0, numerator: 3, denominator: 4 },
                { id: 'ts-1', beat: 8, numerator: 7, denominator: 8 },
            ],
        });

        const maps = projectEngineTransportMaps();

        // Beats 0..4 at 120 BPM is two seconds; beats 4..8 at 60 BPM is four
        // more. A meter change read against a flat tempo would land at four.
        expect(maps.timeSignature).toEqual([
            { startSeconds: 0, numerator: 3, denominator: 4 },
            { startSeconds: 6, numerator: 7, denominator: 8 },
        ]);
    });
});
