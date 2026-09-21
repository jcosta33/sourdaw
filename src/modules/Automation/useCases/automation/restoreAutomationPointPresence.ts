import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

type RestoreAutomationPointPresenceInput = {
    laneId: string;
    point: AutomationPoint;
    equalBeatIndex: number;
    replacementPresence: 'present' | 'absent';
    matchedIndex: number;
};

export function restoreAutomationPointPresence({
    laneId,
    point,
    equalBeatIndex,
    replacementPresence,
    matchedIndex,
}: RestoreAutomationPointPresenceInput): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            const points = [...lane.points];
            if (replacementPresence === 'absent') {
                points.splice(matchedIndex, 1);
                return { ...lane, points };
            }
            const firstEqualBeat = points.findIndex((candidate) => candidate.beat >= point.beat);
            const insertionBase = firstEqualBeat < 0 ? points.length : firstEqualBeat;
            const equalBeatCount = points.filter((candidate) => candidate.beat === point.beat).length;
            points.splice(insertionBase + Math.min(equalBeatIndex, equalBeatCount), 0, point);
            return { ...lane, points };
        }),
    });
}
