import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRestoreScratchPadState } from '#/modules/Arrangement/handlers/scratchPad/handleRestoreScratchPadState';
import { markerStore, scratchPadStore } from '#/modules/Arrangement/stores';
import { captureArrangementToScratchPad } from '#/modules/Arrangement/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { workspaceStore } from '../../../stores/workspaceStore';
import { handleCaptureScratchPad } from '../handleCaptureScratchPad';
import { handleToggleScratchPad } from '../handleToggleScratchPad';

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        captureArrangementToScratchPad: vi.fn(actual.captureArrangementToScratchPad),
    };
});

vi.mock('../../../stores/workspaceStore', () => {
    const internal = { value: { scratchPadOpen: false } };
    return {
        workspaceStore: {
            get value() {
                return internal.value;
            },
            set: vi.fn((value) => {
                internal.value = value;
            }),
        },
    };
});

type RestoreScratchPadStateAction = Extract<AppAction, { type: 'restoreScratchPadState' }>;

const markerSections = [
    { id: 'm1', startBeat: 8, endBeat: 16, name: 'Chorus', color: '#222222' },
    { id: 'm0', startBeat: 0, endBeat: 8, name: 'Verse', color: '#111111' },
];
const previousPad = [{ id: 'old-pad', startBeat: 0, endBeat: 4, name: 'Old', color: '#333333', order: 0 }];

describe('Workspace Scratch Pad Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        workspaceStore.set({ scratchPadOpen: false } as any);
        scratchPadStore.set({ sections: [] });
        markerStore.set({ markers: [], sections: markerSections });
    });

    describe('handleCaptureScratchPad', () => {
        it('should capture arrangement and open the pad', () => {
            workspaceStore.set({ scratchPadOpen: false } as any);
            void handleCaptureScratchPad.execute({ type: 'captureScratchPad', payload: undefined });

            expect(captureArrangementToScratchPad).toHaveBeenCalled();
            expect(workspaceStore.set).toHaveBeenCalledWith(expect.objectContaining({ scratchPadOpen: true }));
        });

        it('opens the pad expanded even if it was last closed while collapsed', () => {
            workspaceStore.set({ scratchPadOpen: false, scratchPadCollapsed: true } as any);
            void handleCaptureScratchPad.execute({ type: 'captureScratchPad', payload: undefined });

            expect(workspaceStore.set).toHaveBeenCalledWith(
                expect.objectContaining({ scratchPadOpen: true, scratchPadCollapsed: false })
            );
        });

        it('should capture arrangement and not toggle if already open', () => {
            workspaceStore.set({ scratchPadOpen: true } as any);
            vi.mocked(workspaceStore.set).mockClear();

            void handleCaptureScratchPad.execute({ type: 'captureScratchPad', payload: undefined });

            expect(captureArrangementToScratchPad).toHaveBeenCalled();
            expect(workspaceStore.set).not.toHaveBeenCalled();
        });
    });

    describe('handleCaptureScratchPad undo', () => {
        const action = { type: 'captureScratchPad' as const, payload: undefined };

        it('describe yields a restoreScratchPadState inverse', () => {
            const described = handleCaptureScratchPad.describe(action);
            expect(described.inverseAction?.type).toBe('restoreScratchPadState');
            expect(described.redoAction?.type).toBe('restoreScratchPadState');
        });

        it('undo restores the previous pad exactly (ids included); redo brings back the captured sections', () => {
            scratchPadStore.set({ sections: previousPad });
            const described = handleCaptureScratchPad.describe(action);
            void handleCaptureScratchPad.execute(action);

            const captured = scratchPadStore.value?.sections ?? [];
            expect(captured).toHaveLength(2);
            expect(captured.map((section) => section.id)).not.toContain('old-pad');

            const undo = handleRestoreScratchPadState.execute(described.inverseAction as RestoreScratchPadStateAction);
            expect(undo).toEqual({ status: 'written' });
            expect(scratchPadStore.value?.sections).toEqual(previousPad);
            expect(markerStore.value?.sections).toEqual(markerSections);

            const redo = handleRestoreScratchPadState.execute(described.redoAction as RestoreScratchPadStateAction);
            expect(redo).toEqual({ status: 'written' });
            expect(scratchPadStore.value?.sections).toEqual(captured);
        });

        it('yields a null inverse, isNoop and no write when the arrangement has no marker sections', () => {
            markerStore.set({ markers: [], sections: [] });
            scratchPadStore.set({ sections: previousPad });

            expect(handleCaptureScratchPad.describe(action).inverseAction).toBeNull();
            expect(handleCaptureScratchPad.isNoop?.(action)).toBe(true);
            expect(handleCaptureScratchPad.execute(action)).toEqual({ status: 'no-write' });
            expect(scratchPadStore.value?.sections).toEqual(previousPad);
        });
    });

    describe('handleToggleScratchPad', () => {
        it('should toggle from false to true', () => {
            workspaceStore.set({ scratchPadOpen: false } as any);
            void handleToggleScratchPad.execute({ type: 'toggleScratchPad', payload: undefined });
            expect(workspaceStore.set).toHaveBeenCalledWith(expect.objectContaining({ scratchPadOpen: true }));
        });

        it('should toggle from true to false', () => {
            workspaceStore.set({ scratchPadOpen: true } as any);
            void handleToggleScratchPad.execute({ type: 'toggleScratchPad', payload: undefined });
            expect(workspaceStore.set).toHaveBeenCalledWith(expect.objectContaining({ scratchPadOpen: false }));
        });

        it('forgets the collapsed state when it closes the pad', () => {
            workspaceStore.set({ scratchPadOpen: true, scratchPadCollapsed: true } as any);
            void handleToggleScratchPad.execute({ type: 'toggleScratchPad', payload: undefined });
            expect(workspaceStore.set).toHaveBeenCalledWith(
                expect.objectContaining({ scratchPadOpen: false, scratchPadCollapsed: false })
            );
        });

        it('is a no-op when the workspace store value is null (guard branch)', () => {
            // Drive the store value to null via the mock setter, then clear
            // the call log so only post-null writes are counted.
            workspaceStore.set(null);
            vi.mocked(workspaceStore.set).mockClear();

            void handleToggleScratchPad.execute({ type: 'toggleScratchPad', payload: undefined });

            expect(workspaceStore.set).not.toHaveBeenCalled();
        });
    });
});
