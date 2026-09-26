import { describe, expect, it } from 'vitest';

import { defaultTransportState } from '#/modules/Transport/stores';

import { type DawProjectParseResult } from '../dawProjectTypes';
import { mapToProjectData } from '../mapToProjectData';

function minimalParsed(): DawProjectParseResult {
    return {
        meta: { title: 'Imported', artist: '', comment: '' },
        initialTempo: 120,
        initialTimeSignature: { numerator: 4, denominator: 4 },
        tempoChanges: [],
        timeSignatureChanges: [],
        tracks: [],
        markers: [],
        audioAssets: new Map(),
    };
}

// `transport.masterGain` is the 0-100 master fader scale (100 = unity); how
// the transport restore converts it to linear gain is outside this spec, which
// observes only the imported value.
describe('mapToProjectData — master gain scale', () => {
    it('opens an imported DAWproject at the default master level, not at -42 dB', () => {
        const data = mapToProjectData({
            parsed: minimalParsed(),
            bufferIdsByPath: new Map(),
            fileName: 'imported.dawproject',
        });

        expect(data.transport.masterGain).toBe(defaultTransportState.masterGain);
    });
});
