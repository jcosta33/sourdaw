import { runLegacyCommandMutation } from '#/modules/Command/useCases';

import { warpStates } from '../../stores/warpStates';

type MarkerBeatValues = {
    originalBeat: number;
    warpedBeat: number;
};

type SetMarkerBeatValuesInput = {
    clipId: string;
    markerId: string;
    values: MarkerBeatValues;
};

function setMarkerBeatValues(input: SetMarkerBeatValuesInput): void {
    const current = warpStates.get(input.clipId);
    if (!current) {
        return;
    }
    warpStates.set(input.clipId, {
        ...current,
        markers: current.markers.map((marker) =>
            marker.id === input.markerId
                ? {
                      ...marker,
                      originalBeat: input.values.originalBeat,
                      warpedBeat: input.values.warpedBeat,
                  }
                : marker
        ),
    });
}

type CommitWarpMarkerBeatDragInput = {
    clipId: string;
    markerId: string;
    beforeOriginalBeat: number;
    beforeWarpedBeat: number;
};

export function commitWarpMarkerBeatDrag(input: CommitWarpMarkerBeatDragInput): void {
    void runLegacyCommandMutation((pushUndoEntry) => {
        const current = warpStates.get(input.clipId);
        if (!current) {
            return;
        }
        const marker = current.markers.find((candidate) => candidate.id === input.markerId);
        if (!marker) {
            return;
        }
        const beforeValues = {
            originalBeat: input.beforeOriginalBeat,
            warpedBeat: input.beforeWarpedBeat,
        };
        const afterValues = {
            originalBeat: marker.originalBeat,
            warpedBeat: marker.warpedBeat,
        };
        if (
            beforeValues.originalBeat === afterValues.originalBeat &&
            beforeValues.warpedBeat === afterValues.warpedBeat
        ) {
            return;
        }

        pushUndoEntry(
            'Move elastic marker',
            () => {
                setMarkerBeatValues({ clipId: input.clipId, markerId: input.markerId, values: beforeValues });
            },
            () => {
                setMarkerBeatValues({ clipId: input.clipId, markerId: input.markerId, values: afterValues });
            }
        );
    });
}
