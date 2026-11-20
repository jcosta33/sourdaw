import { describe, expect, it, vi } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';

import { createAcceptanceRenderLaw } from './acceptanceRenderLaw';

describe('acceptance render law source reuse', () => {
    it('bounds oscillator synthesis to one period while preserving the original waveform', () => {
        const frequencies = [110, 330, 1000, 3000, 6000, 12_000];
        const sampleRate = 48_000;
        const tempo = 137;
        const startBeat = 13.812345;
        const durationBeats = 4.6;
        const frames = Math.round((durationBeats * 60 * sampleRate) / tempo);
        const track = { ...createTrack({ id: 'periodic', name: 'Periodic', kind: 'audio' }), gain: 1 };
        for (const position of [0, 1, 2]) {
            const law = createAcceptanceRenderLaw({
                trackPosition: () => position,
                tempo: () => tempo,
                liveTracks: () => [track],
                masterGain: () => 1,
            });
            const sin = vi.spyOn(Math, 'sin');
            let rendered: AudioBuffer;
            try {
                rendered = law.renderTrack({
                    targetTrackId: track.id,
                    renderTracks: [track],
                    startBeat,
                    endBeat: startBeat + durationBeats,
                });
                expect(sin.mock.calls.length).toBeLessThanOrEqual(4800 * frequencies.length * 2 + frames + 1);
            } finally {
                sin.mockRestore();
            }
            const weights = frequencies.map((_, index) => 2 ** -Math.abs(index - position));
            const norm = Math.sqrt(weights.reduce((sum, weight) => sum + weight * weight, 0));
            const lag = (position * Math.PI) / 18;
            let maxError = 0;
            for (let frame = 0; frame < frames; frame++) {
                const time = (startBeat * 60) / tempo + frame / sampleRate;
                const sinceStrike = time % (60 / tempo);
                const rise = 0.5 * (1 - Math.cos((Math.PI * Math.min(sinceStrike, 0.005)) / 0.005));
                const decay = Math.exp(-Math.max(0, sinceStrike - 0.005) / 0.03);
                const envelope =
                    (0.12 + 0.03 * position) * (0.2 + 0.2 * position + (0.8 - 0.2 * position) * rise * decay);
                let left = 0;
                let right = 0;
                for (let index = 0; index < frequencies.length; index++) {
                    const phase = 2 * Math.PI * frequencies[index]! * time;
                    left += (weights[index]! / norm) * Math.sin(phase);
                    right += (weights[index]! / norm) * Math.sin(phase - lag * (index + 1));
                }
                maxError = Math.max(maxError, Math.abs(rendered.getChannelData(0)[frame]! - envelope * left));
                maxError = Math.max(maxError, Math.abs(rendered.getChannelData(1)[frame]! - envelope * right));
            }
            expect(maxError).toBeLessThan(1e-7);
        }
    });

    it('reuses identical source samples without changing the rendered audio', () => {
        const track = createTrack({ id: 'source', name: 'Source', kind: 'audio' });
        const law = createAcceptanceRenderLaw({
            trackPosition: () => 1,
            tempo: () => 120,
            liveTracks: () => [track],
            masterGain: () => 1,
        });
        const input = { targetTrackId: track.id, renderTracks: [track], startBeat: 0, endBeat: 0.01 };
        const sin = vi.spyOn(Math, 'sin');
        try {
            const cold = law.renderTrack(input);
            const coldCalls = sin.mock.calls.length;
            sin.mockClear();
            const hit = law.renderTrack(input);
            expect(hit.getChannelData(0)).toEqual(cold.getChannelData(0));
            expect(hit.getChannelData(1)).toEqual(cold.getChannelData(1));
            expect(sin.mock.calls.length).toBeLessThan(coldCalls);
        } finally {
            sin.mockRestore();
        }
    });

    it('invalidates changed timing and position and keeps returned buffers independent', () => {
        const track = createTrack({ id: 'source', name: 'Source', kind: 'audio' });
        let tempo = 120;
        let position = 1;
        const makeLaw = () =>
            createAcceptanceRenderLaw({
                trackPosition: () => position,
                tempo: () => tempo,
                liveTracks: () => [track],
                masterGain: () => 1,
            });
        const law = makeLaw();
        const render = (startBeat: number, endBeat: number) => ({
            targetTrackId: track.id,
            renderTracks: [track],
            startBeat,
            endBeat,
        });
        const original = law.renderTrack(render(0, 0.01));
        const expected = Float32Array.from(original.getChannelData(0));
        original.getChannelData(0).fill(0);
        expect(law.renderTrack(render(0, 0.01)).getChannelData(0)).toEqual(expected);

        for (const change of [
            { start: 0.01, end: 0.02, tempo: 120, position: 1 },
            { start: 0, end: 0.01, tempo: 100, position: 1 },
            { start: 0, end: 0.02, tempo: 120, position: 1 },
            { start: 0, end: 0.01, tempo: 120, position: 2 },
        ]) {
            tempo = change.tempo;
            position = change.position;
            const input = render(change.start, change.end);
            const actual = law.renderTrack(input);
            const fresh = makeLaw().renderTrack(input);
            expect(actual.getChannelData(0)).toEqual(fresh.getChannelData(0));
            expect(actual.getChannelData(1)).toEqual(fresh.getChannelData(1));
            expect(actual.getChannelData(0)).not.toEqual(expected);
        }
    });

    it('keeps cached sources intact through devices and pre-fader sends', () => {
        const bus = createTrack({ id: 'bus', name: 'Bus', kind: 'bus' });
        const track = {
            ...createTrack({ id: 'source', name: 'Source', kind: 'audio' }),
            gain: 0.25,
            sends: [{ busId: bus.id, level: 1, preFader: true }],
            devices: [
                {
                    id: 'gain',
                    name: 'Gain',
                    type: 'builtin-gain' as const,
                    bypassed: false,
                    parameterValues: { 'gain-level': -6 },
                },
            ],
        };
        const makeLaw = () =>
            createAcceptanceRenderLaw({
                trackPosition: () => 1,
                tempo: () => 120,
                liveTracks: () => [track, bus],
                masterGain: () => 1,
            });
        const law = makeLaw();
        const input = { targetTrackId: bus.id, renderTracks: [track, bus], startBeat: 0, endBeat: 0.01 };
        const first = law.renderTrack(input);
        const second = law.renderTrack(input);
        const fresh = makeLaw().renderTrack(input);
        expect(first.getChannelData(0)).toEqual(fresh.getChannelData(0));
        expect(second.getChannelData(0)).toEqual(fresh.getChannelData(0));
        const bypassed = { ...track, devices: [] };
        const unprocessed = law.renderTrack({ ...input, renderTracks: [bypassed, bus] });
        const freshUnprocessed = makeLaw().renderTrack({ ...input, renderTracks: [bypassed, bus] });
        expect(unprocessed.getChannelData(0)).toEqual(freshUnprocessed.getChannelData(0));
        expect(unprocessed.getChannelData(0)).not.toEqual(first.getChannelData(0));
    });
});
