import { type ProofTarget } from '../models/ProofPatch';

export type ProofPatchSelection = { kind: 'target'; target: ProofTarget } | { kind: 'preset'; presetId: string };

export type ProofPatchSelectionSnapshot = {
    parameters: Readonly<Record<string, number | null>>;
    name: string;
    presetId: string | null;
};

export type ProofPatchSelectionAction = {
    type: 'setProofPatchSelection';
    payload: {
        deviceId: string;
        trackId: string;
        deviceIds: readonly string[];
        selection: ProofPatchSelection;
        before: ProofPatchSelectionSnapshot;
        after: ProofPatchSelectionSnapshot;
    };
};

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        proof: ProofPatchSelectionAction;
    }
}
