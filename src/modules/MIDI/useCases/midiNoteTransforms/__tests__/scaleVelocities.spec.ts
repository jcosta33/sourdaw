import { describe, it, expect, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';

import { midiStore } from '../../../stores/midiStore';
import { scaleVelocities } from '../scaleVelocities';

describe('scaleVelocities', () => {
    beforeEach(() => {
        Container.clear();
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    it('leaves missing clips unchanged', () => {
        scaleVelocities('missing-clip', 'linear');

        const state = midiStore.value;
        if (!state) {
            throw new Error('Expected MIDI state');
        }
        expect(state.notesByClipId).toEqual({});
    });

    it('scales velocities with MIDI-owned curve math', () => {
        midiStore.set({
            notesByClipId: {
                clip1: [
                    { id: 'n1', pitch: 60, velocity: 20, startBeat: 0, duration: 1 },
                    { id: 'n2', pitch: 64, velocity: 100, startBeat: 1, duration: 1 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        scaleVelocities('clip1', 'compress', 10, 110);

        const state = midiStore.value;
        if (!state) {
            throw new Error('Expected MIDI state');
        }
        expect(state.notesByClipId.clip1?.map((note) => note.velocity)).toEqual([40, 80]);
    });
});
