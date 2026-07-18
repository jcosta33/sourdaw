import { describe, it, expect, vi, beforeEach } from 'vitest';

import type * as updateClipRepo from '../../../repositories/track/updateClip';

const mocks = vi.hoisted(() => ({
    updateClip: vi.fn<(typeof updateClipRepo)['updateClip']>(),
}));

vi.mock('../../../repositories/track/updateClip', () => ({ updateClip: mocks.updateClip }));

import { lockClip } from '../lockClip';
import { muteClip } from '../muteClip';
import { nudgeClip } from '../nudgeClip';
import { setClipColor } from '../setClipColor';
import { setClipFade } from '../setClipFade';
import { setClipGain } from '../setClipGain';
import { trimClipEnd } from '../trimClipEnd';
import { trimClipStart } from '../trimClipStart';

vi.mock('#/modules/Automation/useCases', () => ({ shiftClipAutomation: vi.fn() }));
vi.mock('#/modules/MIDI/useCases', () => ({ shiftClipMidiNotes: vi.fn() }));

describe('clip editing operations', () => {
    beforeEach(() => vi.clearAllMocks());

    describe('nudgeClip', () => {
        it('moves clip by positive beats', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation(
                (_id: string, fn: (c: { startBeat: number; endBeat: number; locked: boolean }) => unknown) => {
                    result.push(fn({ startBeat: 0, endBeat: 4, locked: false }));
                }
            );
            nudgeClip('c1', 2);
            const updated = result[0] as { startBeat: number; endBeat: number };
            expect(updated.startBeat).toBe(2);
            expect(updated.endBeat).toBe(6);
        });

        it('does not move locked clips', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation(
                (_id: string, fn: (c: { startBeat: number; endBeat: number; locked: boolean }) => unknown) => {
                    result.push(fn({ startBeat: 0, endBeat: 4, locked: true }));
                }
            );
            nudgeClip('c1', 2);
            expect(result[0]).toMatchObject({ startBeat: 0, locked: true });
        });

        it('clamps to 0 minimum', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation(
                (_id: string, fn: (c: { startBeat: number; endBeat: number; locked: boolean }) => unknown) => {
                    result.push(fn({ startBeat: 1, endBeat: 5, locked: false }));
                }
            );
            nudgeClip('c1', -10);
            expect((result[0] as { startBeat: number }).startBeat).toBe(0);
        });
    });

    describe('setClipColor', () => {
        it('sets color on clip', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation((_id: string, fn: (c: { color: string }) => unknown) => {
                result.push(fn({ color: 'old' }));
            });
            setClipColor('c1', 'cyan');
            expect((result[0] as { color: string }).color).toBe('cyan');
        });
    });

    describe('trimClipStart', () => {
        it('trims start backward', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation(
                (
                    _id: string,
                    fn: (c: { startBeat: number; endBeat: number; audioOffsetBeats?: number }) => unknown
                ) => {
                    result.push(fn({ startBeat: 2, endBeat: 8, audioOffsetBeats: 0 }));
                }
            );
            trimClipStart('c1', 1);
            const updated = result[0] as { startBeat: number; endBeat: number };
            expect(updated.startBeat).toBe(1);
        });

        it('does not trim past endBeat', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation(
                (_id: string, fn: (c: { startBeat: number; endBeat: number }) => unknown) => {
                    result.push(fn({ startBeat: 2, endBeat: 4 }));
                }
            );
            trimClipStart('c1', 5);
            expect(result[0]).toMatchObject({ startBeat: 2 });
        });

        it('clamps to 0', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation(
                (
                    _id: string,
                    fn: (c: { startBeat: number; endBeat: number; audioOffsetBeats?: number }) => unknown
                ) => {
                    result.push(fn({ startBeat: 2, endBeat: 8, audioOffsetBeats: 0 }));
                }
            );
            trimClipStart('c1', -5);
            expect((result[0] as { startBeat: number }).startBeat).toBe(0);
        });
    });

    describe('trimClipEnd', () => {
        it('extends endBeat', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation(
                (_id: string, fn: (c: { startBeat: number; endBeat: number }) => unknown) => {
                    result.push(fn({ startBeat: 0, endBeat: 4 }));
                }
            );
            trimClipEnd('c1', 8);
            expect((result[0] as { endBeat: number }).endBeat).toBe(8);
        });

        it('does not trim past startBeat', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation(
                (_id: string, fn: (c: { startBeat: number; endBeat: number }) => unknown) => {
                    result.push(fn({ startBeat: 4, endBeat: 8 }));
                }
            );
            trimClipEnd('c1', 2);
            expect(result[0]).toMatchObject({ endBeat: 8 });
        });
    });

    describe('muteClip', () => {
        it('sets muted to true', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation((_id: string, fn: (c: { muted: boolean }) => unknown) => {
                result.push(fn({ muted: false }));
            });
            muteClip('c1', true);
            expect((result[0] as { muted: boolean }).muted).toBe(true);
        });

        it('sets muted to false', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation((_id: string, fn: (c: { muted: boolean }) => unknown) => {
                result.push(fn({ muted: true }));
            });
            muteClip('c1', false);
            expect((result[0] as { muted: boolean }).muted).toBe(false);
        });
    });

    describe('setClipGain', () => {
        it('sets gain', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation((_id: string, fn: (c: { gain: number }) => unknown) => {
                result.push(fn({ gain: 1 }));
            });
            setClipGain('c1', 1.5);
            expect((result[0] as { gain: number }).gain).toBe(1.5);
        });

        it('clamps to 0 minimum', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation((_id: string, fn: (c: { gain: number }) => unknown) => {
                result.push(fn({ gain: 1 }));
            });
            setClipGain('c1', -1);
            expect((result[0] as { gain: number }).gain).toBe(0);
        });

        it('clamps to 2 maximum', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation((_id: string, fn: (c: { gain: number }) => unknown) => {
                result.push(fn({ gain: 1 }));
            });
            setClipGain('c1', 5);
            expect((result[0] as { gain: number }).gain).toBe(2);
        });
    });

    describe('lockClip', () => {
        it('locks clip', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation((_id: string, fn: (c: { locked: boolean }) => unknown) => {
                result.push(fn({ locked: false }));
            });
            lockClip('c1', true);
            expect((result[0] as { locked: boolean }).locked).toBe(true);
        });
    });

    describe('setClipFade', () => {
        it('sets fade values', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation(
                (_id: string, fn: (c: { fadeInBeats: number; fadeOutBeats: number }) => unknown) => {
                    result.push(fn({ fadeInBeats: 0, fadeOutBeats: 0 }));
                }
            );
            setClipFade('c1', 1, 2);
            const updated = result[0] as { fadeInBeats: number; fadeOutBeats: number };
            expect(updated.fadeInBeats).toBe(1);
            expect(updated.fadeOutBeats).toBe(2);
        });

        it('clamps negative fades to 0', () => {
            const result: unknown[] = [];
            mocks.updateClip.mockImplementation(
                (_id: string, fn: (c: { fadeInBeats: number; fadeOutBeats: number }) => unknown) => {
                    result.push(fn({ fadeInBeats: 0, fadeOutBeats: 0 }));
                }
            );
            setClipFade('c1', -1, -2);
            const updated = result[0] as { fadeInBeats: number; fadeOutBeats: number };
            expect(updated.fadeInBeats).toBe(0);
            expect(updated.fadeOutBeats).toBe(0);
        });
    });
});
