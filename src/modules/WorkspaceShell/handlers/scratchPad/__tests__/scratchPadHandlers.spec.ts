import { describe, it, expect, vi, beforeEach } from 'vitest';

import { captureArrangementToScratchPad } from '#/modules/Arrangement/useCases';

import { workspaceStore } from '../../../stores/workspaceStore';
import { handleCaptureScratchPad } from '../handleCaptureScratchPad';
import { handleToggleScratchPad } from '../handleToggleScratchPad';

vi.mock('#/modules/Arrangement/useCases', () => ({
    captureArrangementToScratchPad: vi.fn(),
}));

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

describe('Workspace Scratch Pad Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        workspaceStore.set({ scratchPadOpen: false } as any);
    });

    describe('handleCaptureScratchPad', () => {
        it('should capture arrangement and open the pad', () => {
            workspaceStore.set({ scratchPadOpen: false } as any);
            void handleCaptureScratchPad.execute({ type: 'captureScratchPad', payload: undefined });

            expect(captureArrangementToScratchPad).toHaveBeenCalled();
            expect(workspaceStore.set).toHaveBeenCalledWith(expect.objectContaining({ scratchPadOpen: true }));
        });

        it('should capture arrangement and not toggle if already open', () => {
            workspaceStore.set({ scratchPadOpen: true } as any);
            vi.mocked(workspaceStore.set).mockClear();

            void handleCaptureScratchPad.execute({ type: 'captureScratchPad', payload: undefined });

            expect(captureArrangementToScratchPad).toHaveBeenCalled();
            expect(workspaceStore.set).not.toHaveBeenCalled();
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
