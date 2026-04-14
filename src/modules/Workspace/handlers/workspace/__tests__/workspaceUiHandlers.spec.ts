import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleToggleSidebar } from '../handleToggleSidebar';
import { handleToggleInspector } from '../handleToggleInspector';
import { handleToggleChatPanel } from '../handleToggleChatPanel';
import { handleOpenMixer } from '../handleOpenMixer';
import { handleCloseMixer } from '../handleCloseMixer';
import { handleZoomToFit } from '../handleZoomToFit';

const mocks = vi.hoisted(() => ({
    toggleSidebar: vi.fn(),
    toggleInspector: vi.fn(),
    toggleChatPanel: vi.fn(),
    toggleMixer: vi.fn(),
    zoomToFit: vi.fn(),
}));

vi.mock('../../../useCases/togglePanel/panelToggles/toggleSidebar', () => ({ toggleSidebar: mocks.toggleSidebar }));
vi.mock('../../../useCases/togglePanel/panelToggles/toggleInspector', () => ({ toggleInspector: mocks.toggleInspector }));
vi.mock('../../../useCases/togglePanel/panelToggles/toggleChatPanel', () => ({ toggleChatPanel: mocks.toggleChatPanel }));
vi.mock('../../../useCases/togglePanel/panelToggles/toggleMixer', () => ({ toggleMixer: mocks.toggleMixer }));
vi.mock('../../../useCases/togglePanel/zoomOperations/zoomToFit', () => ({ zoomToFit: mocks.zoomToFit }));

describe('Workspace UI Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleToggleSidebar should delegate to toggleSidebar', () => {
        handleToggleSidebar.execute({ type: 'toggleSidebar', payload: {} });
        expect(mocks.toggleSidebar).toHaveBeenCalled();
    });

    it('handleToggleInspector should delegate to toggleInspector', () => {
        handleToggleInspector.execute({ type: 'toggleInspector', payload: {} });
        expect(mocks.toggleInspector).toHaveBeenCalled();
    });

    it('handleToggleChatPanel should delegate to toggleChatPanel', () => {
        handleToggleChatPanel.execute({ type: 'toggleChatPanel', payload: {} });
        expect(mocks.toggleChatPanel).toHaveBeenCalled();
    });

    it('handleOpenMixer should delegate to toggleMixer', () => {
        handleOpenMixer.execute({ type: 'openMixer', payload: {} });
        expect(mocks.toggleMixer).toHaveBeenCalled();
    });

    it('handleCloseMixer should delegate to toggleMixer', () => {
        handleCloseMixer.execute({ type: 'closeMixer', payload: {} });
        expect(mocks.toggleMixer).toHaveBeenCalled();
    });

    it('handleZoomToFit should delegate to zoomToFit', () => {
        handleZoomToFit.execute({ type: 'zoomToFit', payload: {} });
        expect(mocks.zoomToFit).toHaveBeenCalled();
    });
});
