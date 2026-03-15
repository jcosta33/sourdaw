import { type ReactElement, type ReactNode, useEffect, useRef } from "react";
import { useWorkspaceState } from "../hooks/useWorkspaceState";
import { TransportBar } from "../components/TransportBar";
import { Sidebar } from "../components/Sidebar";
import { InspectorPanel } from "../components/InspectorPanel";
import { MixerPanel } from "../components/MixerPanel";
import { CommandPalette } from "#/modules/Command/presentations/components/CommandPalette";
import { VoiceCommandOverlay } from "#/modules/AiRuntime/presentations/components/VoiceCommandOverlay";
import { useGlobalKeyboardShortcuts } from "#/modules/Command/presentations/hooks/useGlobalKeyboardShortcuts";
import { initializeAudioEngine } from "#/modules/AudioEngine/useCases/initializeAudioEngine";
import { StatusBar } from "../components/StatusBar";
import { cn } from "#/helpers/Styles/cn";

type AppShellProps = {
    children: ReactNode;
};

export const AppShell = ({ children }: AppShellProps): ReactElement => {
    const { sidebarOpen, inspectorOpen, mixerOpen } = useWorkspaceState();

    useGlobalKeyboardShortcuts();

    const audioInitialized = useRef(false);
    useEffect(() => {
        const init = () => {
            if (!audioInitialized.current) {
                audioInitialized.current = true;
                void initializeAudioEngine();
            }
        };
        window.addEventListener("click", init, { once: true });
        window.addEventListener("keydown", init, { once: true });
        return () => {
            window.removeEventListener("click", init);
            window.removeEventListener("keydown", init);
        };
    }, []);

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-base">
            <TransportBar />

            <div className="flex flex-1 overflow-hidden">
                {sidebarOpen && <Sidebar />}

                <main
                    className={cn(
                        "flex-1 overflow-hidden",
                        "border-x border-border/50",
                    )}
                >
                    {children}
                </main>

                {inspectorOpen && <InspectorPanel />}
            </div>

            {mixerOpen && <MixerPanel />}

            <StatusBar />

            <CommandPalette />
            <VoiceCommandOverlay />
        </div>
    );
};
