import { type ReactElement, useState, useEffect } from 'react';

import { Check, MessageSquare, Undo2, X } from 'lucide-react';

import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

import { openAnswerInChat } from '../../useCases/aiPanelActions/openAnswerInChat';
import { undoLastAction } from '../../useCases/aiPanelActions/undoLastAction';
import { type AiChangeNotification } from '../../useCases/notifyAiChange';
import { subscribeAiChangeNotification } from '../../useCases/subscribeAiChangeNotification';

export const AiChangeToast = (): ReactElement | null => {
    const [changes, setChanges] = useState<AiChangeNotification[]>([]);

    useEffect(() => {
        const handler = (change: AiChangeNotification) => {
            setChanges((prev) => [...prev, change]);
        };
        return subscribeAiChangeNotification(handler);
    }, []);

    useEffect(() => {
        // An answer is something to read, not a confirmation to glance at, so it stays until dismissed.
        if (changes.length === 0 || changes[0]!.kind === 'answer') {
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
    const isAppliedChange = latest.kind === 'applied-change';
    const isAnswer = latest.kind === 'answer';
    // A long answer is clamped here; "Open in chat" shows it whole.
    const summaryClassName = cn('text-xs font-medium text-foreground', isAnswer && 'line-clamp-4 whitespace-pre-line');
    const dismissLatest = () => setChanges((prev) => prev.slice(1));
    const detailRows = latest.details.map((detail, detail_position) => {
        const occurrence = latest.details
            .slice(0, detail_position)
            .filter((previous_detail) => previous_detail === detail).length;
        return {
            detail,
            key: `${latest.id}-${detail}-${occurrence}`,
        };
    });

    return (
        <DawUtilityPanel
            className="fixed bottom-16 right-4 z-50 w-72 p-3 animate-in slide-in-from-right-5"
            role="status"
            aria-live="polite"
        >
            <Row align="start" gap={2}>
                {isAppliedChange ? (
                    <Row
                        justify="center"
                        shrink={false}
                        className="mt-0.5 size-5 rounded-full bg-[var(--color-state-success)]/20"
                    >
                        <Check className="size-3 text-[var(--color-state-success)]" />
                    </Row>
                ) : null}
                <div className="flex-1 min-w-0">
                    <p className={summaryClassName}>{latest.summary}</p>
                    {latest.details.length > 0 ? (
                        <Stack gap={0.5} className="mt-1">
                            {detailRows.map((detail_row) => (
                                <p key={detail_row.key} className="text-[10px] text-muted-foreground">
                                    {detail_row.detail}
                                </p>
                            ))}
                        </Stack>
                    ) : null}
                    <Row align="stretch" gap={1} className="mt-2">
                        {isAppliedChange ? (
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => {
                                    undoLastAction();
                                    dismissLatest();
                                }}
                            >
                                <Undo2 className="size-3 mr-1" /> Undo
                            </Button>
                        ) : null}
                        {latest.kind === 'answer' ? (
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => {
                                    openAnswerInChat(latest.answer);
                                    dismissLatest();
                                }}
                            >
                                <MessageSquare className="size-3 mr-1" /> Open in chat
                            </Button>
                        ) : null}
                        <Button variant="ghost" size="xs" onClick={dismissLatest}>
                            <X className="size-3 mr-1" /> Dismiss
                        </Button>
                    </Row>
                </div>
            </Row>
        </DawUtilityPanel>
    );
};
