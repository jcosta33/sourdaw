import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../stores/midiStore';
import { getMidiStoreState } from '../getMidiStoreState';
import { setMidiStoreState } from '../setMidiStoreState';

describe('setMidiStoreState', () => {
    beforeEach(() => {
        midiStore.set({
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
        expect(getMidiStoreState()).toBe(next);
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
            notesByClipId: {
                'clip-valid': [{ id: 'note-valid', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });
});
