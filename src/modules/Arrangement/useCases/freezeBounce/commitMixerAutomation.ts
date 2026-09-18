import { getAutomationLanes, removeAutomationLane, restoreAutomationLanes } from '#/modules/Automation/useCases';

/**
 * The lanes this module retires, kept so the bounce's undo can put them back.
 * Derived from the barrel's own return type rather than restated, so the shape
 * cannot drift; use-case barrels do not re-export types across modules.
 */
export type RetiredAutomationLane = ReturnType<typeof getAutomationLanes>[number];

export type CommittedMixerAutomation = {
    /** The lanes the commit retired, for callers that must observe the write. */
    retiredLanes: RetiredAutomationLane[];
    /** Undo half: put the retired lanes back. Idempotent on replayed lanes. */
    restore: () => void;
    /** Redo half: retire the same lanes again, by their captured ids. */
    retire: () => void;
};

function isTrackMixerLane(lane: RetiredAutomationLane, trackId: string): boolean {
    return lane.trackId === trackId && !lane.clipId && (lane.parameterId === 'gain' || lane.parameterId === 'pan');
}

/**
 * Retire a track's gain/pan automation lanes because the bounce committed their
 * moves into the samples ("Commit volume and pan movements"). Device and
 * clip-scoped lanes are untouched: device parameters are not part of this bake,
 * and clip lanes belong to clips, not to the fader.
 *
 * The returned `restore`/`retire` pair belongs in the bounce's own undo entry —
 * a bounce whose undo covers the write must put the lanes back on undo and
 * retire them again on redo, or undo would resurrect doubled mixer moves.
 */
export function commitMixerAutomation(trackId: string): CommittedMixerAutomation {
    const retiredLanes = getAutomationLanes().filter((lane) => isTrackMixerLane(lane, trackId));
    for (const lane of retiredLanes) {
        removeAutomationLane(lane.id);
    }

    const retiredIds = new Set(retiredLanes.map((lane) => lane.id));

    return {
        retiredLanes,
        restore: () => {
            restoreAutomationLanes(retiredLanes);
        },
        retire: () => {
            for (const lane of getAutomationLanes()) {
                if (retiredIds.has(lane.id)) {
                    removeAutomationLane(lane.id);
                }
            }
        },
    };
}
