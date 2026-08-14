import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultWorkspaceState, workspaceStore } from '../../../stores/workspaceStore';
import { handleCloseMixer } from '../handleCloseMixer';
import { handleOpenMixer } from '../handleOpenMixer';
import { handleToggleChatPanel } from '../handleToggleChatPanel';
import { handleToggleInspector } from '../handleToggleInspector';
import { handleToggleSidebar } from '../handleToggleSidebar';
import { handleZoomToFit } from '../handleZoomToFit';

const mocks = vi.hoisted(() => ({
    toggleSidebar: vi.fn(),
    toggleInspector: vi.fn(),
    toggleChatPanel: vi.fn(),
    zoomToFit: vi.fn(),
}));

vi.mock('../../../useCases/togglePanel/panelToggles/toggleSidebar', () => ({ toggleSidebar: mocks.toggleSidebar }));
vi.mock('../../../useCases/togglePanel/panelToggles/toggleInspector', () => ({
    toggleInspector: mocks.toggleInspector,
}));
vi.mock('../../../useCases/togglePanel/panelToggles/toggleChatPanel', () => ({
    toggleChatPanel: mocks.toggleChatPanel,
}));
vi.mock('../../../useCases/togglePanel/zoomOperations/zoomToFit', () => ({ zoomToFit: mocks.zoomToFit }));

describe('Workspace UI Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleToggleSidebar should delegate to toggleSidebar', () => {
        void handleToggleSidebar.execute({ type: 'toggleSidebar' });
        expect(mocks.toggleSidebar).toHaveBeenCalled();
    });

    it('handleToggleInspector should delegate to toggleInspector', () => {
        void handleToggleInspector.execute({ type: 'toggleInspector' });
        expect(mocks.toggleInspector).toHaveBeenCalled();
    });

    it('handleToggleChatPanel should delegate to toggleChatPanel', () => {
        void handleToggleChatPanel.execute({ type: 'toggleChatPanel' });
        expect(mocks.toggleChatPanel).toHaveBeenCalled();
    });

    it('handleZoomToFit should delegate to zoomToFit', () => {
        void handleZoomToFit.execute({ type: 'zoomToFit' });
        expect(mocks.zoomToFit).toHaveBeenCalled();
    });
});

// The mixer handlers are asserted against the real workspace store rather than a
// `toggleMixer` spy: the defect they carried (both handlers toggling) is invisible
// to a delegation spy, which is green whichever use case is wired up.
describe('Mixer open/close handlers — resulting mixerOpen state', () => {
    beforeEach(() => {
        workspaceStore.set({ ...defaultWorkspaceState, mixerOpen: false });
    });

    it('handleOpenMixer opens the mixer when it is closed', () => {
        void handleOpenMixer.execute({ type: 'openMixer' });
        expect(workspaceStore.value?.mixerOpen).toBe(true);
    });

    it('handleOpenMixer leaves the mixer open when it is already open', () => {
        workspaceStore.set({ ...defaultWorkspaceState, mixerOpen: true });
        void handleOpenMixer.execute({ type: 'openMixer' });
        expect(workspaceStore.value?.mixerOpen).toBe(true);
    });

    it('handleCloseMixer closes the mixer when it is open', () => {
        workspaceStore.set({ ...defaultWorkspaceState, mixerOpen: true });
        void handleCloseMixer.execute({ type: 'closeMixer' });
        expect(workspaceStore.value?.mixerOpen).toBe(false);
    });

    it('handleCloseMixer leaves the mixer closed when it is already closed', () => {
        void handleCloseMixer.execute({ type: 'closeMixer' });
        expect(workspaceStore.value?.mixerOpen).toBe(false);
    });
});
