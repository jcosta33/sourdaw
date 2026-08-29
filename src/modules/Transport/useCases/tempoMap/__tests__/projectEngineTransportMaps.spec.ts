import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
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
        expect(rampTempos[0]).toBe(120);
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
