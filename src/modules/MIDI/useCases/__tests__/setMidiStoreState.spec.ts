import { describe, it, expect, beforeEach } from 'vitest';

import { LEGACY_MIDI_PROBABILITY_SEED, midiStore } from '../../stores/midiStore';
import { getMidiStoreState } from '../getMidiStoreState';
import { setMidiStoreState } from '../setMidiStoreState';

describe('setMidiStoreState', () => {
    const activeProjectSeed = 3_735_928_559;

    beforeEach(() => {
        midiStore.set({
            probabilitySeed: activeProjectSeed,
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should replace the MIDI store with the given state', () => {
        const next = {
            notesByClipId: {
                clip: [
                    {
                        id: 'a',
                        pitch: 48,
                        startBeat: 0,
                        duration: 0.25,
                        velocity: 80,
                        pressure: undefined,
                        slide: undefined,
                        pitchBend: undefined,
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        setMidiStoreState(next);
        expect(getMidiStoreState()).toEqual({
            ...next,
            probabilitySeed: activeProjectSeed,
        });
        expect(getMidiStoreState()?.notesByClipId.clip?.[0]).toHaveProperty('pressure', undefined);
    });

    it('should sanitize malformed neighboring MIDI rows and maps', () => {
        const malformed: unknown = {
            notesByClipId: {
                'clip-valid': [
                    { id: 'note-valid', pitch: 60, startBeat: 0, duration: 1, velocity: 90 },
                    { id: 'note-invalid', pitch: 'high', startBeat: 0, duration: 1, velocity: 90 },
                ],
                'clip-invalid': 'not-an-array',
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        setMidiStoreState(malformed);

        expect(getMidiStoreState()).toEqual({
            probabilitySeed: activeProjectSeed,
            notesByClipId: {
                'clip-valid': [{ id: 'note-valid', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it.each([undefined, -1, 0x1_0000_0000, 1.5])(
        'preserves the active project seed when a legacy setter input carries %s',
        (probabilitySeed) => {
            setMidiStoreState({
                probabilitySeed,
                notesByClipId: {},
                ccByClipId: {},
                pitchBendByClipId: {},
            });

            expect(getMidiStoreState()?.probabilitySeed).toBe(activeProjectSeed);
        }
    );

    it('uses the deterministic fallback when no active project state exists', () => {
        midiStore.set(null);

        setMidiStoreState({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });

        expect(getMidiStoreState()?.probabilitySeed).toBe(LEGACY_MIDI_PROBABILITY_SEED);
    });
});
