import { type ReactElement, useState, useEffect } from "react";
import { Mic } from "lucide-react";
import { cn } from "#/helpers/Styles/cn";
import { parsePromptToActions } from "../../useCases/parsePromptToActions";
import { getProjectContext } from "../../useCases/getProjectContext";
import { executeAppAction } from "#/modules/Command/useCases/executeAppAction";

export const VoiceCommandOverlay = (): ReactElement | null => {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState("");

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "v" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                const target = e.target as HTMLElement;
                if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
                setIsListening(true);
                setTranscript("");
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === "v") {
                setIsListening(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, []);

    useEffect(() => {
        if (!isListening && transcript.trim()) {
            const run = async () => {
                const context = getProjectContext();
                const result = await parsePromptToActions(transcript, context);
                for (const action of result.actions) {
                    await executeAppAction(action);
                }
            };
            void run();
            setTranscript("");
        }
    }, [isListening, transcript]);

    if (!isListening) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4 rounded-xl bg-surface-overlay p-8 shadow-2xl">
                <div className={cn(
                    "flex size-20 items-center justify-center rounded-full",
                    "bg-red-500/20 animate-pulse",
                )}>
                    <Mic className="size-10 text-red-400" />
                </div>

                <p className="text-sm font-medium text-foreground">Listening...</p>

                {transcript && (
                    <p className="max-w-xs text-center text-xs text-muted-foreground">
                        &quot;{transcript}&quot;
                    </p>
                )}

                <p className="text-[10px] text-muted-foreground">Release V to execute</p>
            </div>
        </div>
    );
};
