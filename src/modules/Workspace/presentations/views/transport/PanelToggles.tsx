import { type ReactElement } from 'react';
import {
    PanelLeft,
    PanelRight,
    PanelBottom,
    ListOrdered,
    MessageSquare,
    Settings2,
    TrendingUp,
    Sparkles,
} from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import {
    toggleSidebar,
    toggleInspector,
    toggleMixer,
    toggleChatPanel,
    toggleAutomationPanel,
    toggleTrackList,
} from '../../../useCases/togglePanel';
import {
    subscribeGenerativeAi,
    getGenerativeAiSnapshot,
    toggleGenerativeAiPanel,
} from '#/modules/AiRuntime/useCases/generativeAiActions';
import { useSyncExternalStore } from 'react';

export type PanelTogglesProps = {
    sidebarOpen: boolean;
    inspectorOpen: boolean;
    automationPanelOpen: boolean;
    mixerOpen: boolean;
    chatPanelOpen: boolean;
    trackListOpen: boolean;
};

export const PanelToggles = ({
    sidebarOpen,
    inspectorOpen,
    automationPanelOpen,
    mixerOpen,
    chatPanelOpen,
    trackListOpen,
}: PanelTogglesProps): ReactElement => {
    const aiState = useSyncExternalStore<{ isPanelOpen: boolean }>(subscribeGenerativeAi, getGenerativeAiSnapshot);

    return (
        <div className="flex items-center gap-0.5" role="group" aria-label="Panel toggles">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={trackListOpen ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Toggle track list"
                        aria-pressed={trackListOpen}
                        onClick={toggleTrackList}
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
                    >
                        <PanelRight className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle Inspector (⌘I)</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={automationPanelOpen ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Toggle automation panel"
                        aria-pressed={automationPanelOpen}
                        onClick={toggleAutomationPanel}
                    >
                        <TrendingUp className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle Automation (⌘⇧A)</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={mixerOpen ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Toggle bottom dock"
                        aria-pressed={mixerOpen}
                        onClick={toggleMixer}
                    >
                        <PanelBottom className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle Bottom Dock (⌘M)</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={chatPanelOpen ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Toggle AI chat panel"
                        aria-pressed={chatPanelOpen}
                        onClick={toggleChatPanel}
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
                        aria-label="Toggle Generative AI Dashboard"
                        aria-pressed={aiState.isPanelOpen}
                        onClick={toggleGenerativeAiPanel}
                        className={aiState.isPanelOpen ? 'text-purple-400' : ''}
                    >
                        <Sparkles className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle Generative AI Dashboard</TooltipContent>
            </Tooltip>
            <div className="w-px h-4 bg-border/40 mx-0.5" />
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Open Preferences"
                        onClick={() => document.dispatchEvent(new Event('webdaw:open-preferences'))}
                    >
                        <Settings2 className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Preferences (⌘,)</TooltipContent>
            </Tooltip>
        </div>
    );
};
