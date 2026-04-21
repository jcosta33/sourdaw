import { getAllTracks } from '#/modules/Arrangement/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';

import { automationStore } from '../../stores/automationStore';

import {
    activeRecording,
    pendingPoints,
    touchActive,
    findLaneId,
    clearPointsInRange,
    flushPendingPoints,
} from './recordingSessionState';

export function stopAutomationRecording(): void {
    // Snapshot lane state before flushing for undo
    const laneBefore = automationStore.value ? structuredClone(automationStore.value.lanes) : [];

    const tracks = getAllTracks();

    for (const [key, session] of activeRecording) {
        const track = tracks.find((time) => time.id === session.trackId);

        if (track?.automationMode === 'latch' && session.lastValue !== null) {
            const points = pendingPoints.get(key);
            const lastBeat = points && points.length > 0 ? points[points.length - 1]!.beat : session.startBeat;
            const laneId = findLaneId(session.trackId, session.parameterId);

            if (laneId && lastBeat > session.startBeat) {
                clearPointsInRange(laneId, session.startBeat, lastBeat);
            }
        }

        flushPendingPoints(key);
    }

    const laneAfter = automationStore.value ? structuredClone(automationStore.value.lanes) : [];

    if (JSON.stringify(laneBefore) !== JSON.stringify(laneAfter)) {
        pushUndoEntry(
            'Record Automation',
            () => {
                const current = automationStore.value;
                if (current) {
                    automationStore.set({ lanes: laneBefore });
                }
            },
            () => {
                const current = automationStore.value;
                if (current) {
                    automationStore.set({ lanes: laneAfter });
                }
            }
        );
    }

    activeRecording.clear();
    pendingPoints.clear();
    touchActive.clear();
}
