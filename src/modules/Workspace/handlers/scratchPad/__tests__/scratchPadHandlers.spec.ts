import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    captureArrangementToScratchPad,
    clearScratchPad,
    commitScratchPadToArrangement,
} from '#/modules/Arrangement/useCases';

import { workspaceStore } from '../../../stores/workspaceStore';
import { handleCaptureScratchPad } from '../handleCaptureScratchPad';
import { handleClearScratchPad } from '../handleClearScratchPad';
import { handleCommitScratchPad } from '../handleCommitScratchPad';
import { handleToggleScratchPad } from '../handleToggleScratchPad';

vi.mock('#/modules/Arrangement/useCases', () => ({
    captureArrangementToScratchPad: vi.fn(),
    clearScratchPad: vi.fn(),
    commitScratchPadToArrangement: vi.fn(),
}));

vi.mock('../../../stores/workspaceStore', () => {
    const internal = { value: { scratchPadOpen: false } };
    return {
        workspaceStore: {
            get value() {
                return internal.value;
            },
            set: vi.fn((v) => {
                internal.value = v;
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
            handleCaptureScratchPad.execute({ type: 'captureScratchPad', payload: {} });

            expect(captureArrangementToScratchPad).toHaveBeenCalled();
            expect(workspaceStore.set).toHaveBeenCalledWith(expect.objectContaining({ scratchPadOpen: true }));
        });

        it('should capture arrangement and not toggle if already open', () => {
            workspaceStore.set({ scratchPadOpen: true } as any);
            vi.mocked(workspaceStore.set).mockClear();

            handleCaptureScratchPad.execute({ type: 'captureScratchPad', payload: {} });

            expect(captureArrangementToScratchPad).toHaveBeenCalled();
            expect(workspaceStore.set).not.toHaveBeenCalled();
        });
    });

    describe('handleClearScratchPad', () => {
        it('should clear the scratch pad', () => {
            handleClearScratchPad.execute({ type: 'clearScratchPad', payload: {} });
            expect(clearScratchPad).toHaveBeenCalled();
        });
    });

    describe('handleCommitScratchPad', () => {
        it('should commit scratch pad to arrangement', () => {
            handleCommitScratchPad.execute({ type: 'commitScratchPad', payload: {} });
            expect(commitScratchPadToArrangement).toHaveBeenCalled();
        });
    });

    describe('handleToggleScratchPad', () => {
        it('should toggle from false to true', () => {
            workspaceStore.set({ scratchPadOpen: false } as any);
            handleToggleScratchPad.execute({ type: 'toggleScratchPad', payload: {} });
            expect(workspaceStore.set).toHaveBeenCalledWith(expect.objectContaining({ scratchPadOpen: true }));
        });

        it('should toggle from true to false', () => {
            workspaceStore.set({ scratchPadOpen: true } as any);
            handleToggleScratchPad.execute({ type: 'toggleScratchPad', payload: {} });
            expect(workspaceStore.set).toHaveBeenCalledWith(expect.objectContaining({ scratchPadOpen: false }));
        });
    });
});
