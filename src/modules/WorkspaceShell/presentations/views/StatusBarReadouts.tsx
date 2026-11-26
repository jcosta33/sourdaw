import { type ReactElement } from 'react';

import { History, Users } from 'lucide-react';

import { DawStatusDot } from '#/components/daw/DawStatusDot';
import { Button } from '#/components/ui/button';

import { toggleCollaborationPanel } from '../../useCases/togglePanel/panelToggles/toggleCollaborationPanel';
import { toggleUndoHistory } from '../../useCases/togglePanel/panelToggles/toggleUndoHistory';
import { useCollaborationState } from '../hooks/useCollaborationState';
import { useSelectionLabel } from '../hooks/useSelectionLabel';
import { useUndoState } from '../hooks/useUndoState';

/*
 * Each readout owns the store it shows. A committed action changes the undo step and the selection,
 * and the footer's menus and metric clusters must not render again for it.
 */

export const SelectionReadout = (): ReactElement => {
    const selectionLabel = useSelectionLabel();
    return (
        <span
            role="status"
            className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground"
            title={selectionLabel}
        >
            {selectionLabel}
        </span>
    );
};

export const LastActionReadout = ({ className }: { className: string }): ReactElement | null => {
    const { lastAction } = useUndoState();
    if (!lastAction) {
        return null;
    }
    return <span className={className}>Last: {lastAction.label}</span>;
};

export const UndoHistoryButton = (): ReactElement => {
    const { undoCount } = useUndoState();
    return (
        <Button
            variant="ghost"
            size="xs"
            className="flex h-5 items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={toggleUndoHistory}
            aria-label="Toggle undo history panel"
            title="Undo history"
        >
            <History className="size-3" />
            {undoCount} undo{undoCount !== 1 ? 's' : ''}
        </Button>
    );
};

export const CollaborationButton = (): ReactElement => {
    const collab = useCollaborationState();
    return (
        <Button
            variant="ghost"
            size="xs"
            className="flex h-5 items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={toggleCollaborationPanel}
            aria-label="Toggle collaboration panel"
            data-testid="toggle-collaboration"
            title="Collaboration"
        >
            <DawStatusDot tone={collab.connectionStatus === 'connected' ? 'success' : 'muted'} />
            <Users className="size-3" />
            {collab.isEnabled ? collab.peers.length : 0}
        </Button>
    );
};
