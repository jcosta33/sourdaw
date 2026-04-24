import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { midiStore } from '#/modules/MIDI/stores';

import { scaleVelocities } from '../scaleVelocities';

describe('scaleVelocities', () => {
    beforeEach(() => {
        Container.clear();
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    it('leaves missing clips unchanged', () => {
        scaleVelocities('missing-clip', 'linear');

        expect(midiStore.value.notesByClipId).toEqual({});
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

        expect(midiStore.value.notesByClipId.clip1?.map((note) => note.velocity)).toEqual([40, 80]);
    });
});
