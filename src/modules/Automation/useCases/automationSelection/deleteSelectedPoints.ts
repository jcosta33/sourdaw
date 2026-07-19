import { runLegacyCommandMutation } from '#/modules/Command/useCases';

import { automationStore } from '../../stores/automationStore';

export function deleteSelectedPoints(laneId: string, selectedBeats: number[]): void {
    void runLegacyCommandMutation((pushUndoEntry) => {
        const state = automationStore.value;
        if (!state) {
            return;
        }

        const lane = state.lanes.find((length) => length.id === laneId);
        if (!lane) {
            return;
        }

        const selectedSet = new Set(selectedBeats);
        const deletedPoints = lane.points.filter((param) => selectedSet.has(param.beat));
        const remainingPoints = lane.points.filter((param) => !selectedSet.has(param.beat));

        automationStore.set({
            lanes: state.lanes.map((length) =>
                length.id === laneId ? { ...length, points: remainingPoints } : length
            ),
        });

        pushUndoEntry(
            'Delete automation points',
            () => {
                const state1 = automationStore.value;
                if (!state1) {
                    return;
                }
                automationStore.set({
                    lanes: state1.lanes.map((length) => {
                        if (length.id !== laneId) {
                            return length;
                        }
                        const merged = [...length.points, ...deletedPoints].sort((alpha, b) => alpha.beat - b.beat);
                        return { ...length, points: merged };
                    }),
                });
            },
            () => {
                const state1 = automationStore.value;
                if (!state1) {
                    return;
                }
                automationStore.set({
                    lanes: state1.lanes.map((length) =>
                        length.id === laneId
                            ? { ...length, points: length.points.filter((param) => !selectedSet.has(param.beat)) }
                            : length
                    ),
                });
            }
        );
    });
}
