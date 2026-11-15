import { type DrumPreviewCandidateSnapshot, type DrumPreviewSourceClipSnapshot } from '#/utils/handlerContract';

export type DrumPreviewBranchPlanSnapshot = {
    readonly ownerId: string;
    readonly createdAt: number;
    readonly expectedSourceBranchId: string;
    readonly expectedSourceHeads: readonly string[];
    readonly expectedDocuments: readonly {
        readonly docId: string;
        readonly heads: readonly string[];
    }[];
    readonly expectedBranchState: {
        readonly activeBranchId: string;
        readonly branches: readonly {
            readonly branchId: string;
            readonly name: string;
            readonly rootDocId: string;
            readonly sourceBranchId: string | null;
            readonly createdAt: number;
            readonly createdFromHeads: readonly string[];
            readonly note: string;
        }[];
    };
    readonly sectionId: string;
    readonly sectionName: string;
    readonly sectionStartBeat: number;
    readonly sectionEndBeat: number;
    readonly candidateCount: 3;
    readonly varyingRoles: readonly ['snare', 'hi-hat'];
    readonly kick: DrumPreviewSourceClipSnapshot;
    readonly snare: DrumPreviewSourceClipSnapshot;
    readonly hiHat: DrumPreviewSourceClipSnapshot;
    readonly candidates: readonly DrumPreviewCandidateSnapshot[];
};

export type DeleteDrumPreviewBranchesSnapshot = {
    readonly ownerId: string;
    readonly expectedSourceBranchId: string;
    readonly branches: readonly {
        readonly branchId: string;
        readonly branchName: string;
        readonly rootDocId: string;
        readonly expectedHeads: readonly string[];
    }[];
};

export type CrdtDocumentAppAction =
    | {
          type: 'createDrumPreviewBranches';
          payload: DrumPreviewBranchPlanSnapshot;
      }
    | {
          /** Internal guarded inverse for `createDrumPreviewBranches`. */
          type: 'deleteDrumPreviewBranches';
          payload: DeleteDrumPreviewBranchesSnapshot;
      };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        crdtDocument: CrdtDocumentAppAction;
    }
}
