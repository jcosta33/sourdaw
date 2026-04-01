import { type ReactElement, useState, useSyncExternalStore } from 'react';

import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { GitBranch, Plus, Merge, Trash2, Check, X } from 'lucide-react';

import { type BranchRecord, type BranchStoreState, MAIN_BRANCH_ID } from '../../models/BranchTypes';
import { branchStore } from '../../stores/branchStore';
import {
    forkProjectBranch,
    switchBranch,
    mergeBranch,
    deleteBranch,
} from '../../useCases/crdtBranching';

const defaultState: BranchStoreState = {
    branches: [],
    activeBranchId: MAIN_BRANCH_ID,
};

type BranchManagerDialogProps = {
    onClose: () => void;
};

export const BranchManagerDialog = ({ onClose }: BranchManagerDialogProps): ReactElement => {
    const state = useSyncExternalStore(
        (cb) => branchStore.subscribe(cb),
        () => branchStore.value ?? defaultState
    );
    const [newBranchName, setNewBranchName] = useState('');
    const [creating, setCreating] = useState(false);

    const handleCreate = async () => {
        if (!newBranchName.trim()) {
            return;
        }
        setCreating(true);
        try {
            await forkProjectBranch(newBranchName.trim());
            setNewBranchName('');
        } catch (error) {
            console.error('Failed to create branch:', error);
        }
        setCreating(false);
    };

    const handleSwitch = (branchId: string) => {
        if (branchId === state.activeBranchId) {
            return;
        }
        try {
            switchBranch(branchId);
        } catch (error) {
            console.error('Failed to switch branch:', error);
        }
    };

    const handleMerge = async (sourceBranchId: string) => {
        try {
            await mergeBranch(sourceBranchId);
        } catch (error) {
            console.error('Failed to merge branch:', error);
        }
    };

    const handleDelete = (branchId: string) => {
        try {
            deleteBranch(branchId);
        } catch (error) {
            console.error('Failed to delete branch:', error);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-96 rounded-lg bg-zinc-900 p-4 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <GitBranch className="size-4 text-muted-foreground" />
                        <h2 className="text-sm font-semibold text-white">Branches</h2>
                    </div>
                    <Button variant="ghost" size="icon-xs" onClick={onClose}>
                        <X className="size-3" />
                    </Button>
                </div>

                {/* Branch list */}
                <div className="flex flex-col gap-1 mb-4 max-h-60 overflow-y-auto">
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

                {/* Create new branch */}
                <div className="flex gap-1.5">
                    <Input
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        placeholder="New branch name"
                        className="h-7 text-xs flex-1"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
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
    <div className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${isActive ? 'bg-muted/30' : 'hover:bg-muted/10'}`}>
        <GitBranch className="size-3 shrink-0 text-muted-foreground" />
        <button onClick={onSwitch} className="flex-1 text-left min-w-0">
            <span className="truncate text-foreground">{branch.name}</span>
        </button>
        {isActive ? (
            <Check className="size-3 text-[var(--color-state-success)] shrink-0" />
        ) : (
            <>
                <Button variant="ghost" size="icon-xs" onClick={onMerge} title="Merge into current branch">
                    <Merge className="size-3" />
                </Button>
                {branch.branchId !== MAIN_BRANCH_ID ? (
                    <Button variant="ghost" size="icon-xs" onClick={onDelete} title="Delete branch">
                        <Trash2 className="size-3" />
                    </Button>
                ) : null}
            </>
        )}
    </div>
);
