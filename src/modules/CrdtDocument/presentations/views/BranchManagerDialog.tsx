import { type ReactElement, useState } from 'react';

import { GitBranch, Plus, Merge, Trash2, Check, X } from 'lucide-react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';

import { branchStore, type BranchRecord, type BranchStoreState, MAIN_BRANCH_ID } from '../../stores/branchStore';
import { deleteBranch } from '../../useCases/crdtBranching/deleteBranch';
import { forkProjectBranch } from '../../useCases/crdtBranching/forkProjectBranch';
import { mergeBranch } from '../../useCases/crdtBranching/mergeBranch';
import { switchBranch } from '../../useCases/crdtBranching/switchBranch';

const defaultState: BranchStoreState = {
    branches: [],
    activeBranchId: MAIN_BRANCH_ID,
};

type BranchManagerDialogProps = {
    onClose: () => void;
};

export const BranchManagerDialog = ({ onClose }: BranchManagerDialogProps): ReactElement => {
    const state = useStore(branchStore, defaultState);
    const [newBranchName, setNewBranchName] = useState('');
    const [creating, setCreating] = useState(false);
    // Every branch operation could fail — a rejected persistence write, a full
    // `localStorage` quota — and until #1557 all four caught into `logger.warn`
    // and rendered nothing. That made the whole dialog a silent no-op under a
    // sealed origin: click Delete, the row stays, nothing is said. "The user can
    // try again" only works if the user is told there is anything to retry.
    //
    // Carries a sequence number, not just the text. `setOperationError(null)`
    // followed by `setOperationError(message)` in one handler batches into a
    // single render, so retrying the same failing operation produced identical
    // text, zero DOM mutations, and no re-announcement — the alert spoke once
    // and then went quiet for every subsequent failure. The sequence keys the
    // element, so each failure remounts it and is announced.
    const [operationError, setOperationError] = useState<string | null>(null);
    // Counted separately from the message, and never reset. Every handler calls
    // `setOperationError(null)` before it starts, so a counter derived from the
    // message state would see `null` and restart at 1 on every failure — which
    // is the batching trap this exists to escape, one level down.
    const [failureSeq, setFailureSeq] = useState(0);

    const reportFailure = (verb: string, branchName: string, error: unknown): void => {
        logger.warn(`Failed to ${verb} branch:`, error);
        // Names the branch as well as the operation: with four operations over a
        // list of rows, "Failed to delete branch" does not say which row, and it
        // names an action so the message is not just a statement of loss.
        setOperationError(
            `Could not ${verb} branch "${branchName}" — try again, or free up storage space if the problem persists.`
        );
        setFailureSeq((current) => current + 1);
    };

    const findBranchName = (branchId: string): string => {
        return state.branches.find((branch) => branch.branchId === branchId)?.name ?? branchId;
    };

    const handleCreate = async () => {
        const requestedName = newBranchName.trim();
        if (!requestedName) {
            return;
        }
        setCreating(true);
        setOperationError(null);
        try {
            await forkProjectBranch(requestedName);
            setNewBranchName('');
        } catch (error) {
            reportFailure('create', requestedName, error);
        }
        setCreating(false);
    };

    const handleSwitch = (branchId: string) => {
        if (branchId === state.activeBranchId) {
            return;
        }
        setOperationError(null);
        switchBranch(branchId).catch((error) => {
            reportFailure('switch to', findBranchName(branchId), error);
        });
    };

    const handleMerge = async (sourceBranchId: string) => {
        setOperationError(null);
        try {
            await mergeBranch(sourceBranchId);
        } catch (error) {
            reportFailure('merge', findBranchName(sourceBranchId), error);
        }
    };

    const handleDelete = (branchId: string) => {
        setOperationError(null);
        try {
            deleteBranch(branchId);
        } catch (error) {
            reportFailure('delete', findBranchName(branchId), error);
        }
    };

    return (
        <Row
            justify="center"
            className="fixed inset-0 z-50 bg-bg-scrim/90 px-4 backdrop-blur-[2px]"
            role="dialog"
            aria-modal="true"
            aria-label="Branches"
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    onClose();
                }
            }}
        >
            <DawUtilityPanel className="w-full max-w-sm">
                <DawHeaderBand
                    className="px-4 py-3"
                    startSlot={<GitBranch className="size-3.5 text-muted-foreground" />}
                    title="Branches"
                    titleClassName="text-[11px] text-foreground"
                    actions={
                        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close branch manager">
                            <X className="size-3" />
                        </Button>
                    }
                />

                <Stack gap={4} className="px-4 py-4">
                    {operationError === null ? null : (
                        <p key={failureSeq} role="alert" className="text-[11px] text-[var(--color-state-danger)]">
                            {operationError}
                        </p>
                    )}

                    <Stack gap={1} className="max-h-60 overflow-y-auto">
                        {state.branches.map((branch) => (
                            <BranchRow
                                key={branch.branchId}
                                branch={branch}
                                isActive={branch.branchId === state.activeBranchId}
                                onSwitch={() => handleSwitch(branch.branchId)}
                                onMerge={() => void handleMerge(branch.branchId)}
                                onDelete={() => handleDelete(branch.branchId)}
                            />
                        ))}
                    </Stack>

                    <Row align="stretch" gap={1.5}>
                        <Input
                            value={newBranchName}
                            onChange={(event) => setNewBranchName(event.target.value)}
                            placeholder="New branch name"
                            className="h-7 flex-1 text-xs"
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    void handleCreate();
                                }
                            }}
                        />
                        <Button
                            variant="outline"
                            size="xs"
                            onClick={() => void handleCreate()}
                            disabled={!newBranchName.trim() || creating}
                            className="gap-1"
                        >
                            <Plus className="size-3" />
                            Fork
                        </Button>
                    </Row>
                </Stack>
            </DawUtilityPanel>
        </Row>
    );
};

type BranchRowProps = {
    branch: BranchRecord;
    isActive: boolean;
    onSwitch: () => void;
    onMerge: () => void;
    onDelete: () => void;
};

const BranchRow = ({ branch, isActive, onSwitch, onMerge, onDelete }: BranchRowProps): ReactElement => (
    <div
        className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${isActive ? 'bg-muted/30' : 'hover:bg-muted/10'}`}
    >
        <GitBranch className="size-3 shrink-0 text-muted-foreground" />
        <Button
            variant="bare"
            size="bare"
            onClick={onSwitch}
            className="flex-1 text-left min-w-0"
            aria-label={`Switch to branch ${branch.name}`}
            aria-current={isActive ? 'true' : undefined}
        >
            <span className="truncate text-foreground">{branch.name}</span>
        </Button>
        {isActive ? (
            <Check className="size-3 text-[var(--color-state-success)] shrink-0" />
        ) : (
            <>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={onMerge}
                    title="Merge into current branch"
                    aria-label={`Merge branch ${branch.name} into current branch`}
                >
                    <Merge className="size-3" />
                </Button>
                {branch.branchId !== MAIN_BRANCH_ID ? (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={onDelete}
                        title="Delete branch"
                        aria-label={`Delete branch ${branch.name}`}
                    >
                        <Trash2 className="size-3" />
                    </Button>
                ) : null}
            </>
        )}
    </div>
);
