type InsertTimeOperation = {
    type: 'insert';
    atBeat: number;
    durationBeats: number;
};

type DeleteTimeOperation = {
    type: 'delete';
    startBeat: number;
    endBeat: number;
};

type PreparedTimeOperation = {
    status: 'ready' | 'rejected';
    hasChanges: boolean;
    apply: () => boolean;
    revert: () => boolean;
};

type PreparedTimeOperationWithInversePlan = PreparedTimeOperation & {
    inversePlan: Record<string, unknown> | null;
};

type AutomationOwnerSnapshot = {
    trackId: string;
    eligible: boolean;
    clipIds: readonly string[];
};

type MidiOwnerSnapshot = {
    trackId: string;
    eligible: boolean;
    clips: readonly {
        clipId: string;
        startBeat: number;
        endBeat: number;
        midiOffsetBeats?: number;
    }[];
};

type MidiSplitOperation = {
    sourceClipId: string;
    newClipId: string;
    splitBeat: number;
    discardBeforeBeat?: number;
};

type MidiCopyOperation = {
    sourceClipId: string;
    newClipId: string;
};

type MidiTimeOperation =
    | InsertTimeOperation
    | (DeleteTimeOperation & {
          splits: readonly MidiSplitOperation[];
          removeClipIds: readonly string[];
      })
    | {
          type: 'duplicate';
          startBeat: number;
          endBeat: number;
          copies: readonly MidiCopyOperation[];
      };

type MidiReplayPlan = {
    version: 1;
    notes: readonly {
        role: 'split-right' | 'duplicate-clone';
        sourceClipId: string;
        sourceNoteId: string;
        sourceNoteIndex: number;
        targetClipId: string;
        targetNoteId: string;
    }[];
};

type PreparedMidiTimeOperation = PreparedTimeOperation & {
    replayPlan: MidiReplayPlan;
    inversePlan: Record<string, unknown> | null;
};

export type TimeOperationDependencies = {
    prepareAutomationTimeOperation: (input: {
        operation: InsertTimeOperation | DeleteTimeOperation;
        owners: readonly AutomationOwnerSnapshot[];
        /** Clip ids this operation retires; their clip-scoped lanes go with them. */
        removedClipIds: readonly string[];
    }) => PreparedTimeOperationWithInversePlan;
    prepareAutomationTimeStateRestore: (plan: unknown) => PreparedTimeOperation;
    prepareMidiGlobalTimeTransaction: (input: {
        operation: MidiTimeOperation;
        owners: readonly MidiOwnerSnapshot[];
        replayPlan?: MidiReplayPlan;
    }) => PreparedMidiTimeOperation;
    prepareMidiTimeStateRestore: (plan: unknown) => PreparedTimeOperation;
    prepareTimelineMapTimeOperation: (input: {
        operation: InsertTimeOperation | DeleteTimeOperation;
    }) => PreparedTimeOperationWithInversePlan;
    prepareTimelineMapStateRestore: (plan: unknown) => PreparedTimeOperation;
};

export let timeOperationDependencies: TimeOperationDependencies | null = null;

export function setTimeOperationDependencies(deps: TimeOperationDependencies | null): void {
    timeOperationDependencies = deps;
}
