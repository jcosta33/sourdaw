import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { aiStore } from '#/modules/AiGeneration/stores';

import { PanelToggles } from '../PanelToggles';

const mocks = vi.hoisted(() => ({
    toggleTrackList: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleInspector: vi.fn(),
    toggleDualView: vi.fn(),
    toggleMixer: vi.fn(),
    toggleVirtualKeyboard: vi.fn(),
    toggleChatPanel: vi.fn(),
    toggleAiPanel: vi.fn(),
    openPreferencesDialog: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(),
}));

vi.mock('#/modules/AiGeneration/useCases', () => ({
    toggleAiPanel: mocks.toggleAiPanel,
}));

vi.mock('#/modules/WorkspaceShell/useCases/dialogs/openPreferencesDialog', () => ({
    openPreferencesDialog: mocks.openPreferencesDialog,
}));
vi.mock('#/modules/WorkspaceShell/useCases/togglePanel/panelToggles/toggleChatPanel', () => ({
    toggleChatPanel: mocks.toggleChatPanel,
}));
vi.mock('#/modules/WorkspaceShell/useCases/togglePanel/panelToggles/toggleDualView', () => ({
    toggleDualView: mocks.toggleDualView,
}));
vi.mock('#/modules/WorkspaceShell/useCases/togglePanel/panelToggles/toggleInspector', () => ({
    toggleInspector: mocks.toggleInspector,
}));
vi.mock('#/modules/WorkspaceShell/useCases/togglePanel/panelToggles/toggleMixer', () => ({
    toggleMixer: mocks.toggleMixer,
}));
vi.mock('#/modules/WorkspaceShell/useCases/togglePanel/panelToggles/toggleSidebar', () => ({
    toggleSidebar: mocks.toggleSidebar,
}));
vi.mock('#/modules/WorkspaceShell/useCases/togglePanel/panelToggles/toggleTrackList', () => ({
    toggleTrackList: mocks.toggleTrackList,
}));
vi.mock('#/modules/WorkspaceShell/useCases/togglePanel/panelToggles/toggleVirtualKeyboard', () => ({
    toggleVirtualKeyboard: mocks.toggleVirtualKeyboard,
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
};

const allClosed = {
    sidebarOpen: false,
    inspectorOpen: false,
    mixerOpen: false,
    chatPanelOpen: false,
    trackListOpen: false,
    virtualKeyboardOpen: false,
    dualViewOpen: false,
};

describe('PanelToggles', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useStore).mockImplementation((_store, defaultValue) => defaultValue);
    });

    it('routes each panel toggle button to its useCase', () => {
        renderWithTooltip(<PanelToggles {...allClosed} />);

        fireEvent.click(screen.getByLabelText('Toggle track list'));
        expect(mocks.toggleTrackList).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByLabelText('Toggle browser'));
        expect(mocks.toggleSidebar).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByLabelText('Toggle inspector'));
        expect(mocks.toggleInspector).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByLabelText('Toggle Session + Arrangement View'));
        expect(mocks.toggleDualView).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByLabelText('Toggle bottom dock'));
        expect(mocks.toggleMixer).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByLabelText('Toggle virtual keyboard'));
        expect(mocks.toggleVirtualKeyboard).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByLabelText('Toggle AI chat panel'));
        expect(mocks.toggleChatPanel).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByLabelText('Generate'));
        expect(mocks.toggleAiPanel).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByLabelText('Open Preferences'));
        expect(mocks.openPreferencesDialog).toHaveBeenCalledTimes(1);
    });

    it('marks a toggle as pressed (secondary variant) when its panel is open', () => {
        renderWithTooltip(
            <PanelToggles
                {...allClosed}
                sidebarOpen={true}
                inspectorOpen={true}
                mixerOpen={true}
                trackListOpen={true}
                chatPanelOpen={true}
                virtualKeyboardOpen={true}
                dualViewOpen={true}
            />
        );

        expect(screen.getByLabelText('Toggle browser')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByLabelText('Toggle inspector')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByLabelText('Toggle bottom dock')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByLabelText('Toggle track list')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByLabelText('Toggle AI chat panel')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByLabelText('Toggle virtual keyboard')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByLabelText('Toggle Session + Arrangement View')).toHaveAttribute('aria-pressed', 'true');
    });

    it('marks toggles as not pressed when panels are closed', () => {
        renderWithTooltip(<PanelToggles {...allClosed} />);

        expect(screen.getByLabelText('Toggle browser')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByLabelText('Toggle inspector')).toHaveAttribute('aria-pressed', 'false');
    });

    it('applies the accent colour class to dualView/virtualKeyboard/AI when open', () => {
        // AI panel open comes from the aiStore, so mock that.
        vi.mocked(useStore).mockImplementation((store) => {
            if (store === aiStore) {
                return { isPanelOpen: true };
            }
            return { enabled: false };
        });

        renderWithTooltip(<PanelToggles {...allClosed} dualViewOpen={true} virtualKeyboardOpen={true} />);

        expect(screen.getByLabelText('Toggle Session + Arrangement View')).toHaveClass(
            'text-[var(--color-accent-mint)]'
        );
        expect(screen.getByLabelText('Toggle virtual keyboard')).toHaveClass('text-[var(--color-accent-lavender)]');
        expect(screen.getByLabelText('Generate')).toHaveClass('text-[var(--color-accent-lavender)]');
    });

    it('does not advertise Link while native integration is unsupported', () => {
        renderWithTooltip(<PanelToggles {...allClosed} />);

        expect(screen.queryByTestId('toggle-ableton-link')).not.toBeInTheDocument();
    });
});
