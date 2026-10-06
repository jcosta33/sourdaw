import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trimClipStart } from '../trimClipStart';

import type { Clip } from '#/modules/Arrangement/models/Track';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn<typeof import('#/modules/Arrangement/repositories/track/updateClip').updateClip>(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: mocks.updateClip,
}));

describe('trimClipStart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates startBeat and audioOffsetBeats correctly', () => {
        trimClipStart('c1', 2);

        expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));
        const updater = mocks.updateClip.mock.calls[0]![1];

        const mockClip = { startBeat: 0, endBeat: 10, audioOffsetBeats: 0 } as unknown as Clip;
        const result = updater(mockClip);

        expect(result.startBeat).toBe(2);
        expect(result.audioOffsetBeats).toBe(2);
    });

    it('claps startBeat to zero', () => {
        trimClipStart('c1', -5);
        const updater = mocks.updateClip.mock.calls[0]![1];
        const result = updater({ startBeat: 2, endBeat: 10, audioOffsetBeats: 0 } as unknown as Clip);

        expect(result.startBeat).toBe(0);
        expect(result.audioOffsetBeats).toBe(-2);
    });

    it('ignores trim if new start is after endBeat', () => {
        trimClipStart('c1', 15);
        const updater = mocks.updateClip.mock.calls[0]![1];
        const mockClip = { startBeat: 0, endBeat: 10 } as unknown as Clip;
        const result = updater(mockClip);

        expect(result).toBe(mockClip);
    });

    it('defaults a missing audioOffsetBeats to zero when applying the trim delta', () => {
        trimClipStart('c1', 3);
        const updater = mocks.updateClip.mock.calls[0]![1];
        // Clip carries no audioOffsetBeats — the updater must treat it as 0.
        const mockClip = { startBeat: 0, endBeat: 10 } as unknown as Clip;
        const result = updater(mockClip);

        expect(result.startBeat).toBe(3);
        expect(result.audioOffsetBeats).toBe(3);
    });

    it('advances midiOffsetBeats when trimming a MIDI clip start later', () => {
        trimClipStart('c1', 2);
        const updater = mocks.updateClip.mock.calls[0]![1];
        const mockClip = {
            startBeat: 0,
            endBeat: 10,
            type: 'midi',
            midiOffsetBeats: 0,
        } as unknown as Clip;
        const noteStartBeat = 4;
        const absoluteBefore = mockClip.startBeat + noteStartBeat - (mockClip.midiOffsetBeats ?? 0);

        const result = updater(mockClip);

        expect(result.startBeat).toBe(2);
        expect(result.midiOffsetBeats).toBe(2);
        const absoluteAfter = result.startBeat + noteStartBeat - (result.midiOffsetBeats ?? 0);
        expect(absoluteAfter).toBe(absoluteBefore);
    });

    it('advances midiOffsetBeats when trimming a MIDI clip start earlier', () => {
        trimClipStart('c1', 2);
        const updater = mocks.updateClip.mock.calls[0]![1];
        const mockClip = {
            startBeat: 4,
            endBeat: 10,
            type: 'midi',
            midiOffsetBeats: 2,
        } as unknown as Clip;
        const noteStartBeat = 6;
        const absoluteBefore = mockClip.startBeat + noteStartBeat - (mockClip.midiOffsetBeats ?? 0);

        const result = updater(mockClip);

        expect(result.startBeat).toBe(2);
        expect(result.midiOffsetBeats).toBe(0);
        const absoluteAfter = result.startBeat + noteStartBeat - (result.midiOffsetBeats ?? 0);
        expect(absoluteAfter).toBe(absoluteBefore);
    });

    it('clamps MIDI clip startBeat to zero and applies the matching midiOffsetBeats delta', () => {
        trimClipStart('c1', -5);
        const updater = mocks.updateClip.mock.calls[0]![1];
        const mockClip = {
            startBeat: 2,
            endBeat: 10,
            type: 'midi',
            midiOffsetBeats: 1,
        } as unknown as Clip;
        const noteStartBeat = 5;
        const absoluteBefore = mockClip.startBeat + noteStartBeat - (mockClip.midiOffsetBeats ?? 0);

        const result = updater(mockClip);

        expect(result.startBeat).toBe(0);
        expect(result.midiOffsetBeats).toBe(-1);
        const absoluteAfter = result.startBeat + noteStartBeat - (result.midiOffsetBeats ?? 0);
        expect(absoluteAfter).toBe(absoluteBefore);
    });

    it('defaults a missing midiOffsetBeats to zero when trimming a MIDI clip', () => {
        trimClipStart('c1', 3);
        const updater = mocks.updateClip.mock.calls[0]![1];
        const mockClip = { startBeat: 0, endBeat: 10, type: 'midi' } as unknown as Clip;
        const result = updater(mockClip);

        expect(result.startBeat).toBe(3);
        expect(result.midiOffsetBeats).toBe(3);
    });
});
