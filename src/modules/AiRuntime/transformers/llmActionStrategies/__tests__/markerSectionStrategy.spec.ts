import { describe, expect, it } from 'vitest';

import { bridgeMarkerSectionToolCall } from '../markerSectionStrategy';

const baseInput = {
    index: 3,
    markerSignatures: [{ beat: 16, markerId: 'marker-chorus', name: 'Chorus', color: 'oklch(0.40 0.08 70)' }],
    sectionSignatures: [{ sectionId: 'section-verse', startBeat: 0, endBeat: 16, name: 'Verse' }],
};

describe('markerSectionStrategy', () => {
    it('grounds every marker and section strategy', () => {
        expect(
            bridgeMarkerSectionToolCall({
                ...baseInput,
                call: { name: 'addMarker', arguments: { beat: 32, name: 'Bridge' } },
            })
        ).toEqual({ type: 'addMarker', payload: { beat: 32, name: 'Bridge' } });
        expect(
            bridgeMarkerSectionToolCall({
                ...baseInput,
                call: { name: 'removeMarker', arguments: { beat: 16, name: 'Chorus' } },
            })
        ).toEqual({ type: 'removeMarker', payload: { markerId: 'marker-chorus' } });
        expect(
            bridgeMarkerSectionToolCall({
                ...baseInput,
                call: { name: 'setMarkerColor', arguments: { beat: 16, name: 'Chorus', color: 'rose' } },
            })
        ).toEqual({
            type: 'setMarkerColor',
            payload: { markerId: 'marker-chorus', color: 'oklch(0.38 0.08 340)' },
        });
        expect(
            bridgeMarkerSectionToolCall({
                ...baseInput,
                call: { name: 'addSection', arguments: { startBeat: 16, endBeat: 32, name: 'Chorus' } },
            })
        ).toEqual({ type: 'addSection', payload: { startBeat: 16, endBeat: 32, name: 'Chorus' } });
        expect(
            bridgeMarkerSectionToolCall({
                ...baseInput,
                call: { name: 'removeSection', arguments: { startBeat: 0, endBeat: 16, name: 'Verse' } },
            })
        ).toEqual({ type: 'removeSection', payload: { sectionId: 'section-verse' } });
        expect(
            bridgeMarkerSectionToolCall({
                ...baseInput,
                call: {
                    name: 'renameSection',
                    arguments: { startBeat: 0, endBeat: 16, name: 'Verse', newName: 'Intro' },
                },
            })
        ).toEqual({ type: 'renameSection', payload: { sectionId: 'section-verse', name: 'Intro' } });
    });

    it('leaves unregistered actions for the bridge', () => {
        expect(
            bridgeMarkerSectionToolCall({
                ...baseInput,
                call: { name: 'setMasterGain', arguments: { gain: 0.8 } },
            })
        ).toBeNull();
    });
});
