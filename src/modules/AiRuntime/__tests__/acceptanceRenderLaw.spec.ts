import { describe, expect, it, vi } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';

import { createAcceptanceRenderLaw } from './acceptanceRenderLaw';

describe('acceptance render law source reuse', () => {
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
