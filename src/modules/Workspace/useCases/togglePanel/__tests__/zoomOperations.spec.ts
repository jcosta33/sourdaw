import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultWorkspaceState } from '../../../models/WorkspaceState';
import * as workspaceRepo from '../../../repositories/getWorkspaceState';
import { cycleAutomationVisibility } from '../zoomOperations/cycleAutomationVisibility';
import { onScrollToPlayhead } from '../zoomOperations/onScrollToPlayhead';
import { onZoomToFit } from '../zoomOperations/onZoomToFit';
import { onZoomToSelection } from '../zoomOperations/onZoomToSelection';
import { zoomToFit } from '../zoomOperations/zoomToFit';
import { zoomToSelection } from '../zoomOperations/zoomToSelection';

const mocks = vi.hoisted(() => ({
    mockEventBus: {
        emit: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
    },
}));

vi.mock('#/app/registerDependencies', () => ({
    eventBus: mocks.mockEventBus,
}));

vi.mock('../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: vi.fn(),
}));

// We also need to mock trackStore because zoomToSelection uses it
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        value: { tracks: [] },
    },
}));

describe('zoomOperations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(workspaceRepo.getWorkspaceState).mockReset();
    });

    it('should emit zoom.toFit when zoomToFit is called', () => {
        zoomToFit();

        expect(mocks.mockEventBus.emit).toHaveBeenCalledWith('zoom.toFit', undefined);
    });

    it('should emit panel.showAutomation when cycleAutomationVisibility is called', () => {
        cycleAutomationVisibility();

        expect(mocks.mockEventBus.emit).toHaveBeenCalledWith('panel.showAutomation', undefined);
    });

    it('should subscribe via onZoomToFit, onZoomToSelection, onScrollToPlayhead', () => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        expect(onZoomToFit(vi.fn())).toBe(unsubscribe);
        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('zoom.toFit', expect.any(Function));

        expect(onZoomToSelection(vi.fn())).toBe(unsubscribe);
        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('zoom.toSelection', expect.any(Function));

        expect(onScrollToPlayhead(vi.fn())).toBe(unsubscribe);
        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('zoom.scrollToPlayhead', expect.any(Function));
    });

    it('should not emit zoom.toSelection when workspace state is missing', () => {
        vi.mocked(workspaceRepo.getWorkspaceState).mockReturnValue(null);

        zoomToSelection();

        expect(mocks.mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('should not emit zoom.toSelection when no clips are selected', () => {
        vi.mocked(workspaceRepo.getWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            selectedClipIds: [],
            selectedClipId: null,
        });

        zoomToSelection();

        expect(mocks.mockEventBus.emit).not.toHaveBeenCalled();
    });
});
