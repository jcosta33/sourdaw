import { type ReactElement, useState, useEffect } from 'react';
import { Button } from '#/components/ui/button';
import { Check, Undo2, X } from 'lucide-react';
import { undoLastAction } from '#/modules/AiRuntime/useCases/aiPanelActions';

export type AiChangeNotification = {
    id: string;
    summary: string;
    details: string[];
    timestamp: number;
};

let changeListeners: ((change: AiChangeNotification) => void)[] = [];

export const notifyAiChange = (summary: string, details: string[]): void => {
    const notification: AiChangeNotification = {
        id: `ai-change-${Date.now()}`,
        summary,
        details,
        timestamp: Date.now(),
    };
    for (const listener of changeListeners) {
        listener(notification);
    }
};

export const AiChangeToast = (): ReactElement | null => {
    const [changes, setChanges] = useState<AiChangeNotification[]>([]);

    useEffect(() => {
        const handler = (change: AiChangeNotification) => {
            setChanges((prev) => [...prev, change]);
        };
        changeListeners.push(handler);
        return () => {
            changeListeners = changeListeners.filter((l) => l !== handler);
        };
    }, []);

    useEffect(() => {
        if (changes.length === 0) {
            return;
        }
        const timer = setTimeout(() => {
            setChanges((prev) => prev.slice(1));
        }, 5000);
        return () => clearTimeout(timer);
    }, [changes]);

    if (changes.length === 0) {
        return null;
    }

    const latest = changes[0]!;

    return (
        <div
            className="fixed bottom-16 right-4 z-50 w-72 rounded-lg border border-border bg-surface-raised p-3 shadow-xl animate-in slide-in-from-right-5"
            role="status"
            aria-live="polite"
        >
            <div className="flex items-start gap-2">
                <div className="mt-0.5 size-5 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                    <Check className="size-3 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">{latest.summary}</p>
                    {latest.details.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                            {latest.details.map((detail, i) => (
                                <p key={i} className="text-[10px] text-muted-foreground">
                                    {detail}
                                </p>
                            ))}
                        </div>
                    )}
                    <div className="mt-2 flex gap-1">
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                                void undoLastAction();
                                setChanges((prev) => prev.slice(1));
                            }}
                        >
                            <Undo2 className="size-3 mr-1" /> Undo
                        </Button>
                        <Button variant="ghost" size="xs" onClick={() => setChanges((prev) => prev.slice(1))}>
                            <X className="size-3 mr-1" /> Dismiss
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
