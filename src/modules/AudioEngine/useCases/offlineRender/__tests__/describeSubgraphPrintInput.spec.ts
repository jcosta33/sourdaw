import { describe, expect, it } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';

import { describeSubgraphPrintInput } from '../describeSubgraphPrintInput';
import { selectSubgraphPrintInput, type SubgraphPrintInputSource } from '../selectSubgraphPrintInput';

const TARGET_ID = 'track-target';
const SOURCE_ID = 'track-source';

type Take = NonNullable<SubgraphPrintInputSource['takeLanes']>['lanes'][number]['takes'][number];
type Layer = SubgraphPrintInputSource['adjustmentLayers'][number];
type Modulator = SubgraphPrintInputSource['modulators'][number];

const take: Take = { id: 'take-1', clipId: 'clip-1', name: 'Take 1', startBeat: 0, endBeat: 4, selected: true };

const layer: Layer = {
    id: 'layer-1',
    name: 'Layer',
    effectType: 'volume',
    parameters: [{ name: 'Gain', value: -3, min: -24, max: 12, unit: 'dB' }],
    affectedTrackIds: [SOURCE_ID],
    insertionIndex: 0,
    regions: [],
    enabled: true,
    mix: 1,
    color: '#abcdef',
};

const modulator: Modulator = {
    id: 'mod-1',
    name: 'LFO',
    trackId: SOURCE_ID,
    kind: 'lfo',
    config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: false, phase: 0, depth: 0.5 },
    mappings: [{ targetTrackId: SOURCE_ID, targetDeviceId: 'device-1', targetParamId: 'cutoff', amount: 0.5 }],
    enabled: true,
};

// Built once: a track a fresh `createTrack` mints carries ids that differ between calls.
const tracks = [
    createTrack({ id: TARGET_ID, name: 'Target', kind: 'audio' }),
    { ...createTrack({ id: SOURCE_ID, name: 'Source', kind: 'audio' }), outputId: TARGET_ID },
];

function sourceWith(rows: { take: Take; layer: Layer; modulator: Modulator }): SubgraphPrintInputSource {
    return {
        tracks: { tracks, selectedTrackId: null, ghostClips: [] },
        midi: null,
        automationLanes: [],
        sidechainRoutes: [],
        vcaGroups: [],
        takeLanes: {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: SOURCE_ID,
                    takes: [rows.take],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: rows.take.id }],
                },
            ],
        },
        gainEnvelopes: {},
        adjustmentLayers: [rows.layer],
        modulators: [rows.modulator],
    };
}

function describeRows(rows: { take: Take; layer: Layer; modulator: Modulator }) {
    const source = sourceWith(rows);
    const input = selectSubgraphPrintInput({
        targetTrackId: TARGET_ID,
        renderTracks: source.tracks?.tracks ?? [],
        source,
    });
    return describeSubgraphPrintInput(input, () => null);
}

const baseline = { take, layer, modulator };
const printedBaseline = describeRows(baseline);

describe('describeSubgraphPrintInput session rows', () => {
    it.each([
        ['another take is selected', { ...baseline, take: { ...take, selected: !take.selected } }],
        ['a take is renamed', { ...baseline, take: { ...take, name: 'Renamed take' } }],
        ['an adjustment layer is renamed', { ...baseline, layer: { ...layer, name: 'Renamed layer' } }],
        ['an adjustment layer is recoloured', { ...baseline, layer: { ...layer, color: '#123456' } }],
        ['a modulator is renamed', { ...baseline, modulator: { ...modulator, name: 'Renamed' } }],
    ])('describes the same value when %s', (_name, rows) => {
        expect(describeRows(rows)).toEqual(printedBaseline);
    });

    it.each([
        ['a take moves', { ...baseline, take: { ...take, endBeat: take.endBeat + 1 } }],
        ['an adjustment layer mix changes', { ...baseline, layer: { ...layer, mix: 0.25 } }],
        ['a modulator is disabled', { ...baseline, modulator: { ...modulator, enabled: false } }],
    ])('describes another value when %s', (_name, rows) => {
        expect(describeRows(rows)).not.toEqual(printedBaseline);
    });
});
