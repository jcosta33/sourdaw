import { afterEach, describe, expect, it } from 'vitest';

import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { createTake, createTakeLane } from '../../../models/TakeLane';
import { captureClipSplitTakeReKeyTransitions } from '../captureClipSplitTakeReKey';

describe('MIDI take source captured before an ordinary clip split', () => {
    afterEach(() => {
        midiStore.set(structuredClone(defaultMidiStoreState));
    });

    it('gives the selected and unselected right takes the original three-slot source and phase', () => {
        midiStore.set({
            ...defaultMidiStoreState,
            notesByClipId: {
                source: [
                    { id: 'selected', pitch: 60, startBeat: 5.5, duration: 1, velocity: 100 },
                    { id: 'other-pass', pitch: 72, startBeat: 9.5, duration: 1, velocity: 100 },
                ],
            },
            ccByClipId: {
                source: [{ id: 'pedal', controller: 64, value: 127, channel: 0, beat: 4.8 }],
            },
            pitchBendByClipId: {
                source: [{ id: 'bend', value: 2048, channel: 0, beat: 4.9 }],
            },
        });
        const clip = ClipDummy.create({
            id: 'source',
            type: 'midi',
            startBeat: 0,
            endBeat: 8,
            midiOffsetBeats: 1,
            loopEnabled: true,
            loopLength: 4,
        });
        const selected = { ...createTake('source', 'Selected', 0, 8, 4), selected: true };
        const unselected = createTake('source', 'Unselected', 0, 8, 8);
        const lane = {
            ...createTakeLane('track-1'),
            takes: [selected, unselected],
            activeCompRegions: [{ startBeat: 0, endBeat: 8, takeId: selected.id }],
        };

        const transitions = captureClipSplitTakeReKeyTransitions({
            trackId: 'track-1',
            sourceClip: clip,
            clipId: clip.id,
            rightClipId: 'right',
            splitBeat: 2,
            clipStartBeat: 0,
            clipEndBeat: 8,
            lanes: [lane],
        });

        expect(transitions).toHaveLength(1);
        const rightTakes = transitions[0]?.takesAfter.filter((take) => take.clipId === 'right') ?? [];
        expect(rightTakes).toHaveLength(2);
        for (const take of rightTakes) {
            const source = Reflect.get(take, 'midiSource');
            expect(source).toMatchObject({
                sourceClipId: 'source',
                phaseHeadBeat: 0,
                passLengthBeats: 4,
                rows: {
                    notes: { present: true, value: [{ id: 'selected' }, { id: 'other-pass' }] },
                    controlChanges: { present: true, value: [{ id: 'pedal' }] },
                    pitchBends: { present: true, value: [{ id: 'bend' }] },
                },
            });
        }
    });
});
