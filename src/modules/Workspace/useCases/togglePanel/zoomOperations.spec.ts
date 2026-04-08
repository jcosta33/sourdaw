import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import {
    zoomToFit,
    zoomToSelection,
    cycleAutomationVisibility,
    onZoomToFit,
    onZoomToSelection,
    onScrollToPlayhead,
} from './zoomOperations';
import * as workspaceRepo from '../../repositories/workspace';
import { defaultWorkspaceState } from '../../models/WorkspaceState';

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
};

vi.mock('../../repositories/workspace', () => ({
    getWorkspaceState: vi.fn(),
}));

describe('zoomOperations', () => {
    beforeEach(() => {
        vi.mocked(workspaceRepo.getWorkspaceState).mockReset();
    });

    it('should emit zoom.toFit when zoomToFit is called', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(zoomToFit, { eventBus });

        zoomToFit();

        expect(eventBus.emit).toHaveBeenCalledWith('zoom.toFit', undefined);
    });

    it('should emit panel.showAutomation when cycleAutomationVisibility is called', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(cycleAutomationVisibility, { eventBus });

        cycleAutomationVisibility();

        expect(eventBus.emit).toHaveBeenCalledWith('panel.showAutomation', undefined);
    });

    it('should subscribe via onZoomToFit, onZoomToSelection, onScrollToPlayhead', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);

        injectDependencies(onZoomToFit, { eventBus });
        expect(onZoomToFit(vi.fn())).toBe(unsubscribe);
        expect(eventBus.on).toHaveBeenCalledWith('zoom.toFit', expect.any(Function));

        injectDependencies(onZoomToSelection, { eventBus });
        expect(onZoomToSelection(vi.fn())).toBe(unsubscribe);
        expect(eventBus.on).toHaveBeenCalledWith('zoom.toSelection', expect.any(Function));

        injectDependencies(onScrollToPlayhead, { eventBus });
        expect(onScrollToPlayhead(vi.fn())).toBe(unsubscribe);
        expect(eventBus.on).toHaveBeenCalledWith('zoom.scrollToPlayhead', expect.any(Function));
    });

    it('should not emit zoom.toSelection when workspace state is missing', () => {
        vi.mocked(workspaceRepo.getWorkspaceState).mockReturnValue(null);

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(zoomToSelection, { eventBus, getWorkspaceState: workspaceRepo.getWorkspaceState });

        zoomToSelection();

        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('should not emit zoom.toSelection when no clips are selected', () => {
        vi.mocked(workspaceRepo.getWorkspaceState).mockReturnValue({
            ...defaultWorkspaceState,
            selectedClipIds: [],
            selectedClipId: null,
        });

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(zoomToSelection, { eventBus, getWorkspaceState: workspaceRepo.getWorkspaceState });

        zoomToSelection();

        expect(eventBus.emit).not.toHaveBeenCalled();
    });
});
