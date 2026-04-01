export type BranchRecord = {
    branchId: string;
    name: string;
    rootDocId: string;
    sourceBranchId: string | null;
    createdAt: number;
    createdFromHeads: string[];
    note: string;
};

export type BranchStoreState = {
    branches: BranchRecord[];
    activeBranchId: string;
};

export const MAIN_BRANCH_ID = 'main';
