import { type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';

export type PartialCommandBatchSelection = Readonly<{
    kind: 'successful-command-batch-preview';
}>;

type PartialCommandBatchSelectionState = {
    availableIntentGroupIds: ReadonlySet<string>;
    envelope: VersionedCommandBatchEnvelope;
};

const selectionState = new WeakMap<PartialCommandBatchSelection, PartialCommandBatchSelectionState>();

export const partialCommandBatchSelection = {
    create(
        envelope: VersionedCommandBatchEnvelope,
        availableIntentGroupIds: readonly string[]
    ): PartialCommandBatchSelection {
        const selection = Object.freeze({ kind: 'successful-command-batch-preview' as const });
        selectionState.set(selection, {
            availableIntentGroupIds: new Set(availableIntentGroupIds),
            envelope: structuredClone(envelope),
        });
        return selection;
    },
    read(selection: PartialCommandBatchSelection): PartialCommandBatchSelectionState | null {
        return selectionState.get(selection) ?? null;
    },
};
