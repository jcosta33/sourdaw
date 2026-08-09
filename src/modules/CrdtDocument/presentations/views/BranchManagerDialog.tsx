import { type ReactElement, useState } from 'react';

import { GitBranch, Plus, Merge, Trash2, Check, X } from 'lucide-react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
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
    const [operationError, setOperationError] = useState<string | null>(null);

    const reportFailure = (message: string, error: unknown): void => {
        logger.warn(`${message}:`, error);
        setOperationError(message);
    };

    const handleCreate = async () => {
        if (!newBranchName.trim()) {
            return;
        }
        setCreating(true);
        setOperationError(null);
        try {
            await forkProjectBranch(newBranchName.trim());
            setNewBranchName('');
        } catch (error) {
            reportFailure('Failed to create branch', error);
        }
        setCreating(false);
    };

    const handleSwitch = (branchId: string) => {
        if (branchId === state.activeBranchId) {
            return;
        }
        setOperationError(null);
        switchBranch(branchId).catch((error) => {
            reportFailure('Failed to switch branch', error);
        });
    };

    const handleMerge = async (sourceBranchId: string) => {
        setOperationError(null);
        try {
            await mergeBranch(sourceBranchId);
        } catch (error) {
            reportFailure('Failed to merge branch', error);
        }
    };

    const handleDelete = (branchId: string) => {
        setOperationError(null);
        try {
            deleteBranch(branchId);
        } catch (error) {
            reportFailure('Failed to delete branch', error);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-bg-scrim/90 px-4 backdrop-blur-[2px]"
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

                <div className="space-y-4 px-4 py-4">
                    {operationError === null ? null : (
                        <p role="alert" className="text-[11px] text-[var(--color-state-danger)]">
                            {operationError}
                        </p>
                    )}

                    <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
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
                    </div>

                    <div className="flex gap-1.5">
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
                    </div>
                </div>
            </DawUtilityPanel>
        </div>
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
        <button
            onClick={onSwitch}
            className="flex-1 text-left min-w-0"
            aria-label={`Switch to branch ${branch.name}`}
            aria-current={isActive ? 'true' : undefined}
        >
            <span className="truncate text-foreground">{branch.name}</span>
        </button>
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
