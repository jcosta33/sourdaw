import { type ReactElement } from "react";
import { Button } from "#/components/ui/button";
import type { AppAction } from "#/modules/Command/models/AppAction";
import { executeAppAction } from "#/modules/Command/useCases/executeAppAction";

type ActionPreviewOverlayProps = {
    actions: AppAction[];
    onConfirm: () => void;
    onCancel: () => void;
};

export const ActionPreviewOverlay = ({
    actions,
    onConfirm,
    onCancel,
}: ActionPreviewOverlayProps): ReactElement => {
    const handleConfirm = async () => {
        for (const action of actions) {
            await executeAppAction(action);
        }
        onConfirm();
    };

    return (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-surface-overlay p-4 shadow-xl">
            <p className="mb-2 text-xs font-medium text-foreground">
                AI wants to perform {actions.length} action{actions.length > 1 ? "s" : ""}:
            </p>

            <ul className="mb-3 space-y-1">
                {actions.map((action, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                        <span className="font-mono text-foreground">{action.type}</span>
                        {"payload" in action && action.payload && (
                            <span className="ml-1 text-muted-foreground/70">
                                {JSON.stringify(action.payload)}
                            </span>
                        )}
                    </li>
                ))}
            </ul>

            <div className="flex gap-2">
                <Button size="xs" onClick={handleConfirm}>
                    Confirm
                </Button>
                <Button size="xs" variant="ghost" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </div>
    );
};
