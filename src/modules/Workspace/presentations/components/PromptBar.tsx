import { type ReactElement, useState, type FormEvent } from "react";
import { Input } from "#/components/ui/input";
import { Button } from "#/components/ui/button";
import { Sparkles, Loader2, Check, X } from "lucide-react";
import { parsePromptToActions } from "#/modules/AiRuntime/useCases/parsePromptToActions";
import { getProjectContext } from "#/modules/AiRuntime/useCases/getProjectContext";
import { executeAppAction } from "#/modules/Command/useCases/executeAppAction";
import type { AppAction } from "#/modules/Command/models/AppAction";
import type { IntentResult } from "#/modules/AiRuntime/models/IntentResult";

export const PromptBar = (): ReactElement => {
    const [value, setValue] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [preview, setPreview] = useState<IntentResult | null>(null);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!value.trim() || isProcessing) return;

        setIsProcessing(true);
        try {
            const context = getProjectContext();
            const result = await parsePromptToActions(value, context);

            if (result.requiresConfirmation && result.actions.length > 0) {
                setPreview(result);
                setIsProcessing(false);
                return;
            }

            for (const action of result.actions) {
                await executeAppAction(action);
            }

            if (result.actions.length === 0) {
                console.warn("No actions parsed from prompt:", value);
            }
        } catch (err) {
            console.error("Prompt execution failed:", err);
        } finally {
            setIsProcessing(false);
            if (!preview) setValue("");
        }
    };

    const confirmPreview = async () => {
        if (!preview) return;
        for (const action of preview.actions) {
            await executeAppAction(action);
        }
        setPreview(null);
        setValue("");
    };

    const cancelPreview = () => {
        setPreview(null);
    };

    if (preview) {
        return (
            <div className="flex items-center gap-2">
                <Sparkles className="size-3.5 shrink-0 text-yellow-400" aria-hidden="true" />
                <span className="text-xs text-foreground">
                    {preview.actions.map((a: AppAction) => a.type).join(", ")}
                </span>
                <Button size="icon-xs" variant="ghost" onClick={confirmPreview} aria-label="Confirm action">
                    <Check className="size-3 text-emerald-400" />
                </Button>
                <Button size="icon-xs" variant="ghost" onClick={cancelPreview} aria-label="Cancel action">
                    <X className="size-3 text-destructive-foreground" />
                </Button>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
            {isProcessing ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : (
                <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <Input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={isProcessing ? "Processing..." : "Type a command... (⌘K for palette)"}
                className="h-7 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60"
                aria-label="Prompt command input"
                disabled={isProcessing}
            />
        </form>
    );
};
