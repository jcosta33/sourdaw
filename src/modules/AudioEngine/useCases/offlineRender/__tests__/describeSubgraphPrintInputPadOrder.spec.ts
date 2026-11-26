import { describe, expect, it } from 'vitest';

import { type Device } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { describeSubgraphPrintInput } from '../describeSubgraphPrintInput';
import { selectSubgraphPrintInput, type SubgraphPrintInputSource } from '../selectSubgraphPrintInput';

const TOASTER_ID = 'track-toaster';

type Track = ReturnType<typeof createTrack>;

const toasterDevice: Device = {
    id: 'device-toaster',
    name: 'Toaster',
    type: 'toaster',
    bypassed: false,
    parameterValues: {},
};

// Built once: a track a fresh `createTrack` mints carries ids that differ between calls.
const toaster: Track = {
    ...createTrack({ id: TOASTER_ID, name: 'Toaster', kind: 'folder' }),
    devices: [toasterDevice],
};
const padOne: Track = { ...createTrack({ id: 'track-pad-1', name: 'Pad 1', kind: 'midi' }), parentId: TOASTER_ID };
const padTwo: Track = { ...createTrack({ id: 'track-pad-2', name: 'Pad 2', kind: 'midi' }), parentId: TOASTER_ID };
const sourceOne: Track = {
    ...createTrack({ id: 'track-source-1', name: 'Source 1', kind: 'audio' }),
    outputId: TOASTER_ID,
};
const sourceTwo: Track = {
    ...createTrack({ id: 'track-source-2', name: 'Source 2', kind: 'audio' }),
    outputId: TOASTER_ID,
};

function read(renderTracks: Track[]) {
    const source: SubgraphPrintInputSource = {
        tracks: { tracks: renderTracks, selectedTrackId: null, ghostClips: [] },
        midi: null,
        automationLanes: [],
        sidechainRoutes: [],
        vcaGroups: [],
        takeLanes: { lanes: [] },
        gainEnvelopes: {},
        adjustmentLayers: [],
        modulators: [],
    };
    const input = selectSubgraphPrintInput({ targetTrackId: TOASTER_ID, renderTracks, source });
    return { description: describeSubgraphPrintInput(input, (content) => content), refs: input.refs };
}

const baseline = read([toaster, padOne, padTwo, sourceOne, sourceTwo]);

describe('describeSubgraphPrintInput Toaster pad order', () => {
    it('selects and describes another input when two pad children of a Toaster swap places', () => {
        const swapped = read([toaster, padTwo, padOne, sourceOne, sourceTwo]);
        expect(swapped.description).not.toEqual(baseline.description);
        expect(swapped.refs).not.toEqual(baseline.refs);
    });

    it('selects and describes the same input when two tracks that are no pad children swap places', () => {
        const swapped = read([toaster, padOne, padTwo, sourceTwo, sourceOne]);
        expect(swapped).toEqual(baseline);
    });
});
