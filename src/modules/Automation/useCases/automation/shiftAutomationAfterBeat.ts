import { automationStore } from '../../stores/automationStore';

type ShiftAutomationAfterBeatInput = {
    atBeat: number;
    deltaBeats: number;
};

export function shiftAutomationAfterBeat(input: ShiftAutomationAfterBeatInput): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    automationStore.set({
        ...state,
        lanes: state.lanes.map((lane) => ({
            ...lane,
            // A negative `deltaBeats` can pull a shifted point behind one that
            // stayed put (see the module spec's "re-sort" case), so this must
            // re-sort after shifting, matching `prepareClipAutomationShiftTransaction`.
            // Every reader of `points` downstream — including the binary
            // search in `batchAddAutomationPoints.ts` — depends on ascending
            // order as a convention this writer must uphold, not an
            // invariant the store enforces for it.
            points: lane.points
                .map((point) =>
                    point.beat >= input.atBeat ? { ...point, beat: point.beat + input.deltaBeats } : point
                )
                .sort((left, right) => left.beat - right.beat),
        })),
    });
}
