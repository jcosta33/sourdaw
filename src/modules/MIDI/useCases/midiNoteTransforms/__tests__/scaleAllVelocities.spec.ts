import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';

import { scaleAllVelocities } from '../scaleAllVelocities';

const note = (id: string, velocity: number) => ({
    id,
    pitch: 60,
    startBeat: 0,
    duration: 0.25,
    velocity,
});

describe('scaleAllVelocities', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 80), note('b', 40)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should multiply velocities by factor and clamp to 1–127', () => {
        scaleAllVelocities('clip1', 0.5);
        expect(midiStore.value?.notesByClipId.clip1?.map((n) => n.velocity)).toEqual([40, 20]);
        scaleAllVelocities('clip1', 10);
        expect(midiStore.value?.notesByClipId.clip1?.every((n) => n.velocity === 127)).toBe(true);
    });

    it('should not mutate when the clip is empty or store is null', () => {
        scaleAllVelocities('empty', 2);
        midiStore.set(null);
        scaleAllVelocities('clip1', 2);
        expect(midiStore.value).toBeNull();
    });
});
