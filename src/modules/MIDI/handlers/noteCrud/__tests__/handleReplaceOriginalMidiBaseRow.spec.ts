import { beforeEach, describe, expect, it } from 'vitest';

import { defaultTrackState } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { type AppAction, type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { midiStore } from '../../../stores/midiStore';
import { handleReplaceOriginalMidiBaseRow } from '../handleReplaceOriginalMidiBaseRow';

const original = { id: 'original', pitch: 60, startBeat: 1, duration: 1, velocity: 90 };
const sibling = { id: 'sibling', pitch: 64, startBeat: 2, duration: 1, velocity: 80 };

function rowAction(
    expected: MidiClipNoteSnapshot | null,
    replacement: MidiClipNoteSnapshot | null,
    present = true
): Extract<AppAction, { type: 'replaceOriginalMidiBaseRow' }> {
    return {
        type: 'replaceOriginalMidiBaseRow',
        payload: {
            clipId: 'clip',
            rowId: 'original',
            expected,
            replacement,
            expectedSlotPresent: present,
            replacementSlotPresent: true,
        },
    };
}

describe('replaceOriginalMidiBaseRow', () => {
    beforeEach(() => {
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'track', kind: 'midi', name: 'MIDI' })],
        });
        if (addClip({ id: 'clip', trackId: 'track', startBeat: 0, endBeat: 4, name: 'Clip', type: 'midi' }) === null) {
            throw new Error('Expected writable MIDI clip');
        }
        midiStore.set({ notesByClipId: { clip: [original, sibling] }, ccByClipId: {}, pitchBendByClipId: {} });
    });

    it('replaces one original row and restores it while preserving a peer sibling edit', () => {
        const action = rowAction(original, { ...original, pitch: 61 });
        midiStore.set({ ...midiStore.value!, notesByClipId: { clip: [original, { ...sibling, velocity: 100 }] } });
        expect(handleReplaceOriginalMidiBaseRow.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(true);
        expect(handleReplaceOriginalMidiBaseRow.execute(action)).toEqual({ status: 'written' });
        expect(midiStore.value?.notesByClipId.clip).toEqual([
            { ...original, pitch: 61 },
            { ...sibling, velocity: 100 },
        ]);
        const inverse = handleReplaceOriginalMidiBaseRow.describe(action).inverseAction;
        if (inverse?.type !== 'replaceOriginalMidiBaseRow') {
            throw new Error('Expected typed inverse');
        }
        expect(handleReplaceOriginalMidiBaseRow.execute(inverse)).toEqual({ status: 'written' });
        expect(midiStore.value?.notesByClipId.clip).toEqual([original, { ...sibling, velocity: 100 }]);
    });

    it('preserves absent and present empty notes buckets across an insertion inverse', () => {
        midiStore.set({ ...midiStore.value!, notesByClipId: {} });
        const action = rowAction(null, original, false);
        expect(handleReplaceOriginalMidiBaseRow.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(true);
        expect(handleReplaceOriginalMidiBaseRow.execute(action)).toEqual({ status: 'written' });
        const inverse = handleReplaceOriginalMidiBaseRow.describe(action).inverseAction;
        if (inverse?.type !== 'replaceOriginalMidiBaseRow') {
            throw new Error('Expected typed inverse');
        }
        expect(handleReplaceOriginalMidiBaseRow.execute(inverse)).toEqual({ status: 'written' });
        expect(midiStore.value?.notesByClipId).not.toHaveProperty('clip');

        midiStore.set({ ...midiStore.value!, notesByClipId: { clip: [] } });
        expect(handleReplaceOriginalMidiBaseRow.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
    });

    it('refuses a changed original row and malformed present pass identity', () => {
        const action = rowAction(original, { ...original, pitch: 61 });
        midiStore.set({ ...midiStore.value!, notesByClipId: { clip: [{ ...original, pitch: 70 }, sibling] } });
        expect(handleReplaceOriginalMidiBaseRow.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(false);
        expect(handleReplaceOriginalMidiBaseRow.execute(action)).toEqual({ status: 'conflict' });
        expect(midiStore.value?.notesByClipId.clip?.[0]?.pitch).toBe(70);

        const malformed = rowAction(original, { ...original, recordingPassIndex: undefined });
        expect(handleReplaceOriginalMidiBaseRow.validate?.(malformed, { actions: [malformed], actionIndex: 0 })).toBe(
            false
        );
    });
});
