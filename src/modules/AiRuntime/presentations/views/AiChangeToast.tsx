import { type ReactElement, useState, useEffect } from 'react';

import { Check, Undo2, X } from 'lucide-react';

import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Button } from '#/components/ui/button';

import { undoLastAction } from '../../useCases/aiPanelActions/undoLastAction';
import { type AiChangeNotification, subscribeAiChangeNotification } from '../../useCases/notifyAiChange';

export const AiChangeToast = (): ReactElement | null => {
    const [changes, setChanges] = useState<AiChangeNotification[]>([]);

    useEffect(() => {
        const handler = (change: AiChangeNotification) => {
            setChanges((prev) => [...prev, change]);
        };
        return subscribeAiChangeNotification(handler);
    }, []);

    useEffect(() => {
        if (changes.length === 0) {
            return undefined;
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
        <DawUtilityPanel
            className="fixed bottom-16 right-4 z-50 w-72 p-3 animate-in slide-in-from-right-5"
            role="status"
            aria-live="polite"
        >
            <div className="flex items-start gap-2">
                <div className="mt-0.5 size-5 rounded-full bg-[var(--color-state-success)]/20 flex items-center justify-center shrink-0">
                    <Check className="size-3 text-[var(--color-state-success)]" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">{latest.summary}</p>
                    {latest.details.length > 0 ? (
                        <div className="mt-1 space-y-0.5">
                            {latest.details.map((detail, index) => (
                                <p key={index} className="text-[10px] text-muted-foreground">
                                    {detail}
                                </p>
                            ))}
                        </div>
                    ) : null}
                    <div className="mt-2 flex gap-1">
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                                undoLastAction();
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
        </DawUtilityPanel>
    );
};
