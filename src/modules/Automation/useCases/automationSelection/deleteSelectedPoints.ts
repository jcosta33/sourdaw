import { automationStore } from '../../stores/automationStore';
import { pushUndoEntry } from '#/modules/Command/useCases';

export function deleteSelectedPoints(laneId: string, selectedBeats: number[]): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane) {
        return;
    }

    const selectedSet = new Set(selectedBeats);
    const deletedPoints = lane.points.filter((p) => selectedSet.has(p.beat));
    const remainingPoints = lane.points.filter((p) => !selectedSet.has(p.beat));

    automationStore.set({
        lanes: state.lanes.map((l) => (l.id === laneId ? { ...l, points: remainingPoints } : l)),
    });

    pushUndoEntry(
        'Delete automation points',
        () => {
            const s = automationStore.value;
            if (!s) {
                return;
            }
            automationStore.set({
                lanes: s.lanes.map((l) => {
                    if (l.id !== laneId) {
                        return l;
                    }
                    const merged = [...l.points, ...deletedPoints].sort((a, b) => a.beat - b.beat);
                    return { ...l, points: merged };
                }),
            });
        },
        () => {
            const s = automationStore.value;
            if (!s) {
                return;
            }
            automationStore.set({
                lanes: s.lanes.map((l) =>
                    l.id === laneId ? { ...l, points: l.points.filter((p) => !selectedSet.has(p.beat)) } : l
                ),
            });
        }
    );
}