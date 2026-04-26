import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { setAllVelocities } from '../setAllVelocities';

function note(id: string, velocity: number) {
    return {
        id,
        pitch: 60,
        startBeat: 0,
        duration: 0.25,
        velocity,
    };
}

describe('setAllVelocities', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 80), note('b', 40)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should set every note velocity to the clamped value', () => {
        setAllVelocities('clip1', 200);
        expect(midiStore.value?.notesByClipId.clip1?.every((node) => node.velocity === 127)).toBe(true);
        setAllVelocities('clip1', 0);
        expect(midiStore.value?.notesByClipId.clip1?.every((node) => node.velocity === 1)).toBe(true);
    });

    it('should do nothing when the clip is empty or missing', () => {
        setAllVelocities('empty', 100);
        midiStore.set({
            notesByClipId: { empty: [] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        setAllVelocities('empty', 100);
        expect(midiStore.value?.notesByClipId.empty).toEqual([]);
    });

    it('should not mutate when the store is null', () => {
        midiStore.set(null);
        setAllVelocities('clip1', 64);
        expect(midiStore.value).toBeNull();
    });
});
