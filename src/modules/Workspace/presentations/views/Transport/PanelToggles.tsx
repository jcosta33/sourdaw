import { type ReactElement, useSyncExternalStore } from 'react';
import {
    PanelLeft,
    PanelRight,
    PanelBottom,
    ListOrdered,
    MessageSquare,
    Settings2,
    Sparkles,
    Piano,
    Link as LinkIcon,
} from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import {
    toggleSidebar,
    toggleInspector,
    toggleMixer,
    toggleChatPanel,
    toggleTrackList,
    toggleVirtualKeyboard,
} from '../../../useCases/togglePanel/panelToggles';
import {
    subscribeAiStore,
    getAiSnapshot,
} from '#/modules/AiGeneration/stores/aiStore';
import { toggleAiPanel } from '#/modules/AiGeneration/useCases/actions/taskManagement';
import { subscribeToLinkStatus, getLinkStatusSnapshot } from '#/modules/AudioEngine/stores/linkStatusStore';
import { enableLink, disableLink } from '#/modules/AudioEngine/useCases/engineAccess';


type PanelTogglesProps = {
    sidebarOpen: boolean;
    inspectorOpen: boolean;
    mixerOpen: boolean;
    chatPanelOpen: boolean;
    trackListOpen: boolean;
    virtualKeyboardOpen: boolean;
};

export const PanelToggles = ({
    sidebarOpen,
    inspectorOpen,
    mixerOpen,
    chatPanelOpen,
    trackListOpen,
    virtualKeyboardOpen,
}: PanelTogglesProps): ReactElement => {
    const aiState = useSyncExternalStore<{ isPanelOpen: boolean }>(subscribeAiStore, getAiSnapshot);
    const linkEnabled = useSyncExternalStore(subscribeToLinkStatus, getLinkStatusSnapshot);

    const handleLinkToggle = (): void => {
        if (linkEnabled) {
            void disableLink();
        } else {
            void enableLink().catch(() => {/* graceful no-op if Link not available */});
        }
    };

    return (
        <div
            className="flex items-center gap-0.5 px-1 py-0.5 rounded-sm"
            style={{
                background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)',
                border: '1px solid rgba(0,0,0,0.4)',
                borderBottom: '1px solid rgba(40,40,40,0.3)',
            }}
            role="group"
            aria-label="Panel toggles"
        >
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
                        variant={virtualKeyboardOpen ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label="Toggle virtual keyboard"
                        aria-pressed={virtualKeyboardOpen}
                        onClick={toggleVirtualKeyboard}
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
                        className={aiState.isPanelOpen ? 'text-[var(--color-accent-lavender)]' : ''}
                    >
                        <Sparkles className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Generate</TooltipContent>
            </Tooltip>
            <div className="w-px h-4 bg-border/40 mx-0.5" />
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={linkEnabled ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        aria-label={linkEnabled ? 'Ableton Link active — click to disable' : 'Enable Ableton Link sync'}
                        aria-pressed={linkEnabled}
                        onClick={handleLinkToggle}
                        className={linkEnabled ? 'text-[var(--color-accent-amber)]' : ''}
                    >
                        <LinkIcon className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Ableton Link{linkEnabled ? ' (active)' : ''}</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Open Preferences"
                        onClick={() => document.dispatchEvent(new Event('sourdaw:open-preferences'))}
                    >
                        <Settings2 className="size-3.5" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Preferences (⌘,)</TooltipContent>
            </Tooltip>
        </div>
    );
};
