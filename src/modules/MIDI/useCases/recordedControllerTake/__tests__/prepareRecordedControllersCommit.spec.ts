import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetCrdtProjectAuthority } from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { recordedControllerTakeState as state } from '../../../repositories/webMidi/recordedControllerTakeState';
import { bufferRecordedMidiCC } from '../bufferRecordedMidiCC';
import { captureRecordedControllerRetirement } from '../captureRecordedControllerRetirement';
import { openRecordedControllerBuffer } from '../openRecordedControllerBuffer';
import { prepareRecordedControllersCommit } from '../prepareRecordedControllersCommit';

const clip = { id: 'owned-controller-clip', startBeat: 4, endBeat: 8 };
function append(value: number): void {
    bufferRecordedMidiCC({ clipId: clip.id, row: { controller: 1, value, beat: 1, channel: 0 } });
}

describe('prepared recorded controller ownership', () => {
    beforeEach(() => {
        resetCrdtProjectAuthority('prepared controller owner');
        transportStore.set({ ...transportStore.value!, isRecording: true });
        state.buffers.clear();
        state.openedClipIds.clear();
        state.committedClipIds.clear();
        state.carriedOverClips.clear();
        state.heldPedalSeeds.clear();
        state.bendRangeSeeds.clear();
        state.heldWheelSeeds.clear();
        state.openedClipIds.add(clip.id);
        openRecordedControllerBuffer(clip.id);
    });

    afterEach(() => {
        transportStore.set({ ...transportStore.value!, isRecording: false });
    });

    it('plans stable row IDs without consuming the owner before publication, then finishes once', async () => {
        append(10);
        const buffer = state.buffers.get(clip.id)!;
        const prepared = prepareRecordedControllersCommit({ clip });
        expect(prepared.rows.cc).toEqual(buffer.cc);
        expect(state.buffers.get(clip.id)).toBe(buffer);
        expect(buffer.cc).toHaveLength(1);
        expect(state.openedClipIds.has(clip.id)).toBe(true);
        await prepared.finish();
        expect(state.buffers.has(clip.id)).toBe(false);
        expect(state.committedClipIds.has(clip.id)).toBe(true);
        // A stale repeated finish cannot consume a replacement owner.
        state.committedClipIds.delete(clip.id);
        append(20);
        const replacement = state.buffers.get(clip.id);
        await prepared.finish();
        expect(state.buffers.get(clip.id)).toBe(replacement);
        expect(replacement?.cc[0]?.value).toBe(20);
    });

    it('plans every row present at describe and keeps only later suffix rows and replacement seeds', async () => {
        append(10);
        state.carriedOverClips.set(clip.id, { cc: 1, pitchBend: 0 });
        append(20);
        const prepared = prepareRecordedControllersCommit({ clip });
        expect(prepared.rows.cc.map((row) => row.value)).toEqual([10, 20]);
        append(30);
        const replacementSeeds = [{ id: 'successor-seed', controller: 64, value: 127, beat: 0, channel: 0 }];
        state.heldPedalSeeds.set(clip.id, replacementSeeds);
        await prepared.finish();
        expect(state.buffers.get(clip.id)?.cc.map((row) => row.value)).toEqual([30]);
        expect(state.heldPedalSeeds.get(clip.id)).toBe(replacementSeeds);
        expect(state.openedClipIds.has(clip.id)).toBe(false);
        expect(state.committedClipIds.has(clip.id)).toBe(false);
    });

    it.each(['buffer', 'root'] as const)('cannot finish a replacement %s owner', async (replacement) => {
        append(10);
        const prepared = prepareRecordedControllersCommit({ clip });
        if (replacement === 'root') {
            resetCrdtProjectAuthority('replacement controller root');
        } else {
            state.buffers.delete(clip.id);
            append(20);
        }
        const retained = state.buffers.get(clip.id);
        await prepared.finish();
        expect(state.buffers.get(clip.id)).toBe(retained);
        expect(retained?.cc).toHaveLength(1);
        expect(state.openedClipIds.has(clip.id)).toBe(true);
    });

    it('does not consume a replacement carried owner or its membership', async () => {
        append(10);
        state.carriedOverClips.set(clip.id, { cc: 1, pitchBend: 0 });
        const prepared = prepareRecordedControllersCommit({ clip });
        const replacement = { cc: 1, pitchBend: 0 };
        state.carriedOverClips.set(clip.id, replacement);
        append(20);
        await prepared.finish();
        expect(state.carriedOverClips.get(clip.id)).toBe(replacement);
        expect(state.openedClipIds.has(clip.id)).toBe(true);
        expect(state.buffers.get(clip.id)?.cc.map((row) => row.value)).toEqual([10, 20]);
    });

    it('retires only its old prefix when a successor take reuses the captured buffer', () => {
        const retire = captureRecordedControllerRetirement(clip.id);
        append(10);
        state.carriedOverClips.set(clip.id, { cc: 1, pitchBend: 0 });
        append(20);
        retire();
        expect(state.buffers.get(clip.id)?.cc.map((row) => row.value)).toEqual([20]);
        expect(state.openedClipIds.has(clip.id)).toBe(false);
        expect(state.carriedOverClips.has(clip.id)).toBe(false);
        retire();
        expect(state.buffers.get(clip.id)?.cc.map((row) => row.value)).toEqual([20]);
    });

    it('retires remaining membership after the falling edge already dropped its missing buffer', () => {
        const retire = captureRecordedControllerRetirement(clip.id);
        state.buffers.delete(clip.id);
        expect(state.openedClipIds.has(clip.id)).toBe(true);
        retire();
        expect(state.openedClipIds.has(clip.id)).toBe(false);
        expect(state.committedClipIds.has(clip.id)).toBe(false);
    });

    it('cannot retire a replacement buffer or root', () => {
        const retire = captureRecordedControllerRetirement(clip.id);
        state.buffers.delete(clip.id);
        append(20);
        const replacement = state.buffers.get(clip.id);
        retire();
        expect(state.buffers.get(clip.id)).toBe(replacement);
        const retireBeforeRootChange = captureRecordedControllerRetirement(clip.id);
        resetCrdtProjectAuthority('retirement replacement root');
        retireBeforeRootChange();
        expect(state.buffers.get(clip.id)).toBe(replacement);
    });
});
