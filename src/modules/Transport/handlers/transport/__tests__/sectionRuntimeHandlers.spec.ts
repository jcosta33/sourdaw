import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readMusicalRange } from '#/modules/Arrangement/stores';
import { getMarkerState } from '#/modules/Arrangement/useCases';

import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { transportStore } from '../../../stores/transportStore';
import { seekPlayhead } from '../../../useCases/transportControls/seekPlayhead';
import { setLoopEnabled } from '../../../useCases/transportControls/setLoopEnabled';
import { setLoopRegion } from '../../../useCases/transportControls/setLoopRegion';
import { setPlayback } from '../../../useCases/transportControls/setPlayback';
import { handleNavigateSection } from '../handleNavigateSection';
import { handleRehearseSection } from '../handleRehearseSection';

vi.mock('#/modules/Arrangement/stores', () => ({ readMusicalRange: vi.fn() }));
vi.mock('#/modules/Arrangement/useCases', () => ({ getMarkerState: vi.fn() }));
vi.mock('../../../stores/playheadPositionRef', () => ({ playheadPositionRef: { current: 0 } }));
vi.mock('../../../stores/transportStore', () => ({
    transportStore: { value: { isPlaying: true, playheadPosition: 0 } },
}));
vi.mock('../../../useCases/transportControls/seekPlayhead', () => ({ seekPlayhead: vi.fn() }));
vi.mock('../../../useCases/transportControls/setLoopEnabled', () => ({ setLoopEnabled: vi.fn(() => true) }));
vi.mock('../../../useCases/transportControls/setLoopRegion', () => ({ setLoopRegion: vi.fn(() => true) }));
vi.mock('../../../useCases/transportControls/setPlayback', () => ({ setPlayback: vi.fn() }));

type MusicalRangeReference = Parameters<typeof readMusicalRange>[0]['range'];
type ArrangementSection = NonNullable<ReturnType<typeof getMarkerState>>['sections'][number];

const section = (id: string, name: string, startBeat: number, endBeat: number): ArrangementSection => ({
    id,
    name,
    startBeat,
    endBeat,
    color: '#778899',
});

const unsortedSections = [
    section('chorus', 'Chorus', 32, 48),
    section('intro', 'Intro', 4, 12),
    section('verse', 'Verse', 16, 28),
];

function atPlayhead(playheadPosition: number): void {
    playheadPositionRef.current = playheadPosition;
}

function withSections(sections: ArrangementSection[]): void {
    vi.mocked(getMarkerState).mockReturnValue({ markers: [], sections });
}

beforeEach(() => {
    vi.clearAllMocks();
    atPlayhead(0);
    withSections(unsortedSections);
    vi.mocked(readMusicalRange).mockImplementation(({ range }: { range: MusicalRangeReference }) => {
        if (range.startBeat === undefined || range.endBeat === undefined || range.endBeat <= range.startBeat) {
            return { kind: 'invalid-range', reason: 'A section must span beats.' };
        }
        return { kind: 'resolved', startBeat: range.startBeat, endBeat: range.endBeat };
    });
    vi.mocked(setLoopRegion).mockReturnValue(true);
    vi.mocked(setLoopEnabled).mockReturnValue(true);
});

describe('handleNavigateSection', () => {
    it('uses the live playhead when the playing transport store snapshot is stale', () => {
        expect(transportStore.value).toMatchObject({ isPlaying: true, playheadPosition: 0 });
        atPlayhead(20);

        handleNavigateSection.execute({ type: 'navigateSection', payload: { direction: 'next' } });

        expect(seekPlayhead).toHaveBeenCalledExactlyOnceWith(32);
    });

    it.each([
        { playhead: 0, direction: 'next' as const, target: 4 },
        { playhead: 5, direction: 'next' as const, target: 16 },
        { playhead: 4, direction: 'next' as const, target: 16 },
        { playhead: 50, direction: 'next' as const, target: null },
        { playhead: 0, direction: 'previous' as const, target: null },
        { playhead: 4, direction: 'previous' as const, target: null },
        { playhead: 5, direction: 'previous' as const, target: 4 },
        { playhead: 16, direction: 'previous' as const, target: 4 },
        { playhead: 20, direction: 'previous' as const, target: 16 },
        { playhead: 50, direction: 'previous' as const, target: 32 },
    ])('moves $direction from playhead $playhead in musical order', ({ playhead, direction, target }) => {
        atPlayhead(playhead);

        handleNavigateSection.execute({ type: 'navigateSection', payload: { direction } });

        if (target === null) {
            expect(seekPlayhead).not.toHaveBeenCalled();
        } else {
            expect(seekPlayhead).toHaveBeenCalledExactlyOnceWith(target);
        }
        expect(setPlayback).not.toHaveBeenCalled();
        expect(setLoopRegion).not.toHaveBeenCalled();
    });

    it('does nothing when the project has no sections', () => {
        withSections([]);

        handleNavigateSection.execute({ type: 'navigateSection', payload: { direction: 'next' } });

        expect(readMusicalRange).not.toHaveBeenCalled();
        expect(seekPlayhead).not.toHaveBeenCalled();
    });

    it('is runtime-only and never enters project undo history', () => {
        expect(handleNavigateSection.undoable).toBe(false);
        expect(handleNavigateSection.executionKind).toBe('runtime');
    });
});

describe('handleRehearseSection', () => {
    it.each([
        { loop: false, label: 'Play Section' },
        { loop: true, label: 'Loop Section' },
    ])('$label uses exact live boundaries and existing transport owners', ({ loop }) => {
        withSections([section('picked', 'Picked', 4.5, 12.75)]);

        handleRehearseSection.execute({ type: 'rehearseSection', payload: { sectionId: 'picked', loop } });

        expect(readMusicalRange).toHaveBeenCalledWith({ range: { startBeat: 4.5, endBeat: 12.75 } });
        expect(setLoopRegion).toHaveBeenCalledExactlyOnceWith(4.5, 12.75, loop);
        if (loop) {
            expect(setLoopEnabled).not.toHaveBeenCalled();
        } else {
            expect(setLoopEnabled).toHaveBeenCalledExactlyOnceWith(false);
            expect(vi.mocked(setLoopRegion).mock.invocationCallOrder[0]!).toBeLessThan(
                vi.mocked(setLoopEnabled).mock.invocationCallOrder[0]!
            );
            expect(vi.mocked(setLoopEnabled).mock.invocationCallOrder[0]!).toBeLessThan(
                vi.mocked(seekPlayhead).mock.invocationCallOrder[0]!
            );
        }
        expect(seekPlayhead).toHaveBeenCalledExactlyOnceWith(4.5);
        expect(setPlayback).toHaveBeenCalledExactlyOnceWith(true);
        expect(vi.mocked(setLoopRegion).mock.invocationCallOrder[0]!).toBeLessThan(
            vi.mocked(seekPlayhead).mock.invocationCallOrder[0]!
        );
        expect(vi.mocked(seekPlayhead).mock.invocationCallOrder[0]!).toBeLessThan(
            vi.mocked(setPlayback).mock.invocationCallOrder[0]!
        );
    });

    it('does not seek or play when disabling the loop cannot be written', () => {
        vi.mocked(setLoopEnabled).mockReturnValue(false);

        handleRehearseSection.execute({ type: 'rehearseSection', payload: { sectionId: 'chorus', loop: false } });

        expect(setLoopRegion).toHaveBeenCalledExactlyOnceWith(32, 48, false);
        expect(setLoopEnabled).toHaveBeenCalledExactlyOnceWith(false);
        expect(seekPlayhead).not.toHaveBeenCalled();
        expect(setPlayback).not.toHaveBeenCalled();
    });

    it('re-resolves the section ID after an edit instead of reusing a context-menu range', () => {
        const original = section('picked', 'Picked', 4, 12);
        const edited = { ...original, startBeat: 8.25, endBeat: 20.5 };
        withSections([edited]);

        handleRehearseSection.execute({ type: 'rehearseSection', payload: { sectionId: original.id, loop: true } });

        expect(setLoopRegion).toHaveBeenCalledWith(8.25, 20.5, true);
        expect(setLoopRegion).not.toHaveBeenCalledWith(4, 12, true);
    });

    it('does nothing when the selected section no longer exists', () => {
        withSections([]);

        handleRehearseSection.execute({ type: 'rehearseSection', payload: { sectionId: 'deleted', loop: true } });

        expect(readMusicalRange).not.toHaveBeenCalled();
        expect(setLoopRegion).not.toHaveBeenCalled();
        expect(seekPlayhead).not.toHaveBeenCalled();
        expect(setPlayback).not.toHaveBeenCalled();
    });

    it('is runtime-only and never enters project undo history', () => {
        expect(handleRehearseSection.undoable).toBe(false);
        expect(handleRehearseSection.executionKind).toBe('runtime');
    });
});
