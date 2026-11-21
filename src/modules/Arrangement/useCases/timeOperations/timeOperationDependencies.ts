import { type AutomationLaneValue } from '../clip/readClipScopedAutomationLanes';

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
    /** Media windows that stay on the source clip beside the boundary split (#5112). */
    retainOnSourceWindows?: readonly { start: number; end: number }[];
    /** The source loops: the new clip copies its whole loop, and nothing is partitioned. */
    copiesLoopMaterial?: true;
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
    savedRestorePlanValidators: {
        automation: (value: unknown) => boolean;
        midi: (value: unknown) => boolean;
        timelineMap: (value: unknown) => boolean;
    };
    prepareAutomationTimeOperation: (input: {
        operation: InsertTimeOperation | DeleteTimeOperation;
        owners: readonly AutomationOwnerSnapshot[];
        /** Clip ids this operation removes; their clip-scoped lanes go with them. */
        removedClipIds: readonly string[];
        /** Clip ids this operation re-keys; their clip-scoped lanes follow. */
        clipIdMigrations?: readonly { sourceClipId: string; targetClipId: string }[];
        /** Whole clip-scoped lanes this operation adds for clips it mints in the
         *  same commit — a split fragment's inherited copy of the source lane. */
        clipLaneCopies?: readonly AutomationLaneValue[];
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

let registeredDependencies: TimeOperationDependencies | null = null;

/**
 * Arrangement may not import the automation, MIDI or tempo-map owners, so the
 * composition root (`#/app/bootstrap`) fills this once at boot, before any
 * command can run.
 */
export function setTimeOperationDependencies(deps: TimeOperationDependencies): void {
    registeredDependencies = deps;
}

export const timeOperationDependencies = {
    /**
     * Reading before registration throws rather than skipping: an unfilled
     * reader would reject every saved restore plan or edit time without the
     * automation, MIDI and tempo-map owners.
     */
    read(caller: string): TimeOperationDependencies {
        if (registeredDependencies === null) {
            throw new Error(
                `${caller}: time operation dependencies are not registered; call setTimeOperationDependencies() from #/app/bootstrap (bootstrap does this)`
            );
        }
        return registeredDependencies;
    },
};
