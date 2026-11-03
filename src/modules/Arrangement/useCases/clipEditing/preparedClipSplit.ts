import { type ClipSplitActionSnapshot, type TakeReKeyLaneTransitionSnapshot } from '#/utils/handlerContract';

export type PreparedClipSplit = {
    readonly adjustedMediaSplit: number;
    readonly previous: ClipSplitActionSnapshot;
    readonly next: ClipSplitActionSnapshot;
    readonly rightClipId: string;
    readonly targetNoteIds: readonly string[];
    readonly takeReKeyTransitions?: readonly TakeReKeyLaneTransitionSnapshot[];
};

// Only fresh handler-materialized action objects key these invocation values.
// JSON and a later dispatch cannot recover a prior preparation. Keep the key
// alive through every sibling and commit consumer; collection ends its lifetime.
export const preparedClipSplits = new WeakMap<object, PreparedClipSplit>();
