import { pushUndoEntry } from '#/modules/Command/useCases';

import { warpStates } from '../../stores/warpStates';

type UpdateWarpMarkerBeatInput = {
    clipId: string;
    markerId: string;
    field: 'originalBeat' | 'warpedBeat';
    beat: number;
    undoGroupId?: string;
    undoGroupLabel?: string;
};

export function updateWarpMarkerBeat(input: UpdateWarpMarkerBeatInput): void {
    const current = warpStates.get(input.clipId);
    if (!current) {
        return;
    }
    const target = current.markers.find((marker) => marker.id === input.markerId);
    if (!target || target[input.field] === input.beat) {
        return;
    }

    const beforeSnapshot = { ...current, markers: [...current.markers] };
    const nextMarkers = current.markers.map((marker) =>
        marker.id === input.markerId ? { ...marker, [input.field]: input.beat } : marker
    );
    const nextState = {
        ...current,
        markers: nextMarkers,
    };
    warpStates.set(input.clipId, nextState);

    if (input.undoGroupId) {
        pushUndoEntry(
            input.field === 'originalBeat' ? 'Move elastic marker source beat' : 'Move elastic marker warp beat',
            () => {
                warpStates.set(input.clipId, beforeSnapshot);
            },
            () => {
                warpStates.set(input.clipId, { ...nextState, markers: [...nextMarkers] });
            },
            { groupId: input.undoGroupId, groupLabel: input.undoGroupLabel }
        );
    }
}
