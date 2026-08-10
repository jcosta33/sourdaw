import { type ReactElement } from 'react';

import {
    PanelLeft,
    PanelRight,
    PanelBottom,
    ListOrdered,
    MessageSquare,
    Settings2,
    Sparkles,
    Piano,
    Layers,
} from 'lucide-react';

import { DawTransportCluster } from '#/components/daw/DawTransportCluster';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { aiStore } from '#/modules/AiGeneration/stores';
import { toggleAiPanel } from '#/modules/AiGeneration/useCases';

import { openPreferencesDialog } from '../../../useCases/dialogs/openPreferencesDialog';
import { toggleChatPanel } from '../../../useCases/togglePanel/panelToggles/toggleChatPanel';
import { toggleDualView } from '../../../useCases/togglePanel/panelToggles/toggleDualView';
import { toggleInspector } from '../../../useCases/togglePanel/panelToggles/toggleInspector';
import { toggleMixer } from '../../../useCases/togglePanel/panelToggles/toggleMixer';
import { toggleSidebar } from '../../../useCases/togglePanel/panelToggles/toggleSidebar';
import { toggleTrackList } from '../../../useCases/togglePanel/panelToggles/toggleTrackList';
import { toggleVirtualKeyboard } from '../../../useCases/togglePanel/panelToggles/toggleVirtualKeyboard';

type AiPanelState = {
    isPanelOpen: boolean;
};

type PanelTogglesProps = {
    sidebarOpen: boolean;
    inspectorOpen: boolean;
    mixerOpen: boolean;
    chatPanelOpen: boolean;
    trackListOpen: boolean;
    virtualKeyboardOpen: boolean;
    dualViewOpen: boolean;
};

export const PanelToggles = ({
    sidebarOpen,
    inspectorOpen,
    mixerOpen,
    chatPanelOpen,
    trackListOpen,
    virtualKeyboardOpen,
    dualViewOpen,
}: PanelTogglesProps): ReactElement => {
    const aiState = useStore<AiPanelState>(aiStore, { isPanelOpen: false });

    return (
        <DawTransportCluster role="group" aria-label="Panel toggles">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={trackListOpen ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Toggle track list"
                        aria-pressed={trackListOpen}
                        onClick={toggleTrackList}
                        data-testid="toggle-track-list"
                    >
                        <ListOrdered className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle Track List (⌘T)</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={sidebarOpen ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Toggle browser"
                        aria-pressed={sidebarOpen}
                        onClick={toggleSidebar}
                        data-testid="toggle-browser"
                    >
                        <PanelLeft className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle Browser (⌘B)</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={inspectorOpen ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Toggle inspector"
                        aria-pressed={inspectorOpen}
                        onClick={toggleInspector}
                        data-testid="toggle-inspector"
                    >
                        <PanelRight className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle Inspector (⌘I)</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={dualViewOpen ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Toggle Session + Arrangement View"
                        aria-pressed={dualViewOpen}
                        onClick={toggleDualView}
                        data-testid="toggle-dual-view"
                        className={dualViewOpen ? 'text-[var(--color-accent-mint)]' : ''}
                    >
                        <Layers className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Session + Arrangement View (D1)</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={mixerOpen ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Toggle bottom dock"
                        aria-pressed={mixerOpen}
                        onClick={toggleMixer}
                        data-onboarding="mixer-button"
                        data-testid="toggle-bottom-dock"
                    >
                        <PanelBottom className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle Bottom Dock (⌘M)</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={virtualKeyboardOpen ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Toggle virtual keyboard"
                        aria-pressed={virtualKeyboardOpen}
                        onClick={toggleVirtualKeyboard}
                        data-testid="toggle-virtual-keyboard"
                        className={virtualKeyboardOpen ? 'text-[var(--color-accent-lavender)]' : ''}
                    >
                        <Piano className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle Virtual Keyboard (⌘⇧K)</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={chatPanelOpen ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Toggle AI chat panel"
                        aria-pressed={chatPanelOpen}
                        onClick={toggleChatPanel}
                        data-testid="toggle-chat"
                    >
                        <MessageSquare className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle AI Chat (⌘J)</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={aiState.isPanelOpen ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Generate"
                        aria-pressed={aiState.isPanelOpen}
                        onClick={toggleAiPanel}
                        data-testid="toggle-generate"
                        className={aiState.isPanelOpen ? 'text-[var(--color-accent-lavender)]' : ''}
                    >
                        <Sparkles className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Generate</TooltipContent>
            </Tooltip>
            <div className="mx-0.5 h-4 w-px daw-seam" />
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Open Preferences"
                        data-testid="toggle-preferences"
                        onClick={openPreferencesDialog}
                    >
                        <Settings2 className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Preferences (⌘,)</TooltipContent>
            </Tooltip>
        </DawTransportCluster>
    );
};
