import { type ReactElement, useState, useEffect } from 'react';

import { Check, Undo2, X } from 'lucide-react';

import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

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
                <Row
                    justify="center"
                    shrink={false}
                    className="mt-0.5 size-5 rounded-full bg-[var(--color-state-success)]/20"
                >
                    <Check className="size-3 text-[var(--color-state-success)]" />
                </Row>
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">{latest.summary}</p>
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
                    </Row>
                </div>
            </Row>
        </DawUtilityPanel>
    );
};
