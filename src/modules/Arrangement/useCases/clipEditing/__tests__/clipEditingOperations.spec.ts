import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn<(typeof updateClipRepo)['updateClip']>(),
    shiftClipAutomation: vi.fn(),
    shiftClipMidiNotes: vi.fn(),
}));

vi.mock('../../../repositories/track/updateClip', () => ({ updateClip: mocks.updateClip }));
vi.mock('#/modules/Automation/useCases', () => ({ shiftClipAutomation: mocks.shiftClipAutomation }));
vi.mock('#/modules/MIDI/useCases', () => ({ shiftClipMidiNotes: mocks.shiftClipMidiNotes }));

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { type Clip } from '../../../models/Track';
import { lockClip } from '../lockClip';
import { muteClip } from '../muteClip';
import { nudgeClip } from '../nudgeClip';
import { setClipColor } from '../setClipColor';
import { setClipFade } from '../setClipFade';
import { setClipGain } from '../setClipGain';
import { trimClipEnd } from '../trimClipEnd';
import { trimClipStart } from '../trimClipStart';

import type * as updateClipRepo from '../../../repositories/track/updateClip';

/** Route the mocked repository through the given clip and collect updater results. */
function captureUpdate(clip: Clip): Clip[] {
    const result: Clip[] = [];
    mocks.updateClip.mockImplementation((_clipId, updater) => {
        result.push(updater(clip));
    });
    return result;
}

describe('clip editing operations', () => {
    beforeEach(() => vi.clearAllMocks());

    describe('nudgeClip', () => {
        it('moves clip by positive beats and shifts notes and automation along', () => {
            const result = captureUpdate(ClipDummy.create({ startBeat: 0, endBeat: 4, locked: false }));
            nudgeClip('c1', 2);
            expect(mocks.updateClip).toHaveBeenCalledWith('c1', expect.any(Function));
            expect(result[0]).toMatchObject({ startBeat: 2, endBeat: 6 });
            expect(mocks.shiftClipMidiNotes).toHaveBeenCalledWith('c1', 2);
            expect(mocks.shiftClipAutomation).toHaveBeenCalledWith('c1', 2);
        });

        it('does not move locked clips and skips content shifting', () => {
            const result = captureUpdate(ClipDummy.create({ startBeat: 0, endBeat: 4, locked: true }));
            nudgeClip('c1', 2);
            expect(result[0]).toMatchObject({ startBeat: 0, endBeat: 4, locked: true });
            expect(mocks.shiftClipMidiNotes).not.toHaveBeenCalled();
            expect(mocks.shiftClipAutomation).not.toHaveBeenCalled();
        });

        it('clamps to 0 minimum and shifts content by the applied delta only', () => {
            const result = captureUpdate(ClipDummy.create({ startBeat: 1, endBeat: 5, locked: false }));
            nudgeClip('c1', -10);
            expect(result[0]).toMatchObject({ startBeat: 0, endBeat: 4 });
            expect(mocks.shiftClipMidiNotes).toHaveBeenCalledWith('c1', -1);
            expect(mocks.shiftClipAutomation).toHaveBeenCalledWith('c1', -1);
        });
    });

    describe('setClipColor', () => {
        it('sets color on clip', () => {
            const result = captureUpdate(ClipDummy.create({ color: '#112233' }));
            setClipColor('c1', 'cyan');
            expect(result[0]?.color).toBe('cyan');
        });
    });

    describe('trimClipStart', () => {
        it('trims start backward and shifts the audio offset by the delta', () => {
            const result = captureUpdate(ClipDummy.create({ startBeat: 2, endBeat: 8, audioOffsetBeats: 0 }));
            trimClipStart('c1', 1);
            expect(result[0]).toMatchObject({ startBeat: 1, endBeat: 8, audioOffsetBeats: -1 });
        });

        it('does not trim past endBeat', () => {
            const result = captureUpdate(ClipDummy.create({ startBeat: 2, endBeat: 4 }));
            trimClipStart('c1', 5);
            expect(result[0]).toMatchObject({ startBeat: 2, endBeat: 4 });
        });

        it('clamps to 0 while offsetting audio from the clamped position', () => {
            const result = captureUpdate(ClipDummy.create({ startBeat: 2, endBeat: 8, audioOffsetBeats: 0 }));
            trimClipStart('c1', -5);
            expect(result[0]).toMatchObject({ startBeat: 0, endBeat: 8, audioOffsetBeats: -2 });
        });
    });

    describe('trimClipEnd', () => {
        it('extends endBeat', () => {
            const result = captureUpdate(ClipDummy.create({ startBeat: 0, endBeat: 4 }));
            trimClipEnd('c1', 8);
            expect(result[0]).toMatchObject({ startBeat: 0, endBeat: 8 });
        });

        it('does not trim past startBeat', () => {
            const result = captureUpdate(ClipDummy.create({ startBeat: 4, endBeat: 8 }));
            trimClipEnd('c1', 2);
            expect(result[0]).toMatchObject({ startBeat: 4, endBeat: 8 });
        });
    });

    describe('muteClip', () => {
        it('sets muted to true', () => {
            const result = captureUpdate(ClipDummy.create({ muted: false }));
            muteClip('c1', true);
            expect(result[0]?.muted).toBe(true);
        });

        it('sets muted to false', () => {
            const result = captureUpdate(ClipDummy.create({ muted: true }));
            muteClip('c1', false);
            expect(result[0]?.muted).toBe(false);
        });
    });

    describe('setClipGain', () => {
        it('sets gain', () => {
            const result = captureUpdate(ClipDummy.create({ gain: 1 }));
            setClipGain('c1', 1.5);
            expect(result[0]?.gain).toBe(1.5);
        });

        it('clamps to 0 minimum', () => {
            const result = captureUpdate(ClipDummy.create({ gain: 1 }));
            setClipGain('c1', -1);
            expect(result[0]?.gain).toBe(0);
        });

        it('clamps to 2 maximum', () => {
            const result = captureUpdate(ClipDummy.create({ gain: 1 }));
            setClipGain('c1', 5);
            expect(result[0]?.gain).toBe(2);
        });
    });

    describe('lockClip', () => {
        it('locks clip', () => {
            const result = captureUpdate(ClipDummy.create({ locked: false }));
            lockClip('c1', true);
            expect(result[0]?.locked).toBe(true);
        });

        it('unlocks clip', () => {
            const result = captureUpdate(ClipDummy.create({ locked: true }));
            lockClip('c1', false);
            expect(result[0]?.locked).toBe(false);
        });
    });

    describe('setClipFade', () => {
        it('sets fade values', () => {
            const result = captureUpdate(ClipDummy.create({ fadeInBeats: 0, fadeOutBeats: 0 }));
            setClipFade('c1', 1, 2);
            expect(result[0]).toMatchObject({ fadeInBeats: 1, fadeOutBeats: 2 });
        });

        it('clamps negative fades to 0', () => {
            const result = captureUpdate(ClipDummy.create({ fadeInBeats: 0.5, fadeOutBeats: 0.5 }));
            setClipFade('c1', -1, -2);
            expect(result[0]).toMatchObject({ fadeInBeats: 0, fadeOutBeats: 0 });
        });
    });
});
