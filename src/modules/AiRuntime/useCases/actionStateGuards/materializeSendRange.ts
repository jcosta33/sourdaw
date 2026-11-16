import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'automateSendRange' }>;

export function materializeSendRange(action: Action, state: MaterializationState): MaterializationStep {
    const { context, tracksById } = state;
    const bus = tracksById.get(action.payload.busId);
    if (!bus || bus.kind !== 'bus') {
        return { status: 'rejected', reason: `Bus is unavailable: ${action.payload.busId}` };
    }
    const section = (context.sections ?? []).find(
        (candidate) => candidate.name.toLocaleLowerCase() === action.payload.sectionName.toLocaleLowerCase()
    );
    if (!section) {
        return { status: 'rejected', reason: `Section is unavailable: ${action.payload.sectionName}` };
    }
    const expectedSends = [];
    for (const trackId of action.payload.trackIds) {
        const track = tracksById.get(trackId);
        const send = track?.sends?.find((candidate) => candidate.busId === action.payload.busId);
        if (!track || !send) {
            return {
                status: 'rejected',
                reason: `Send is unavailable: ${trackId} -> ${action.payload.busId}`,
            };
        }
        expectedSends.push({ trackId, level: send.level, preFader: send.preFader });
    }
    return {
        status: 'accepted',
        actions: [
            {
                type: 'automateSendRange',
                payload: {
                    ...action.payload,
                    busName: bus.name,
                    sectionId: section.id,
                    startBeat: section.startBeat,
                    endBeat: section.endBeat,
                    expectedSends,
                    expectedSection: {
                        name: section.name,
                        startBeat: section.startBeat,
                        endBeat: section.endBeat,
                    },
                },
            },
        ],
    };
}
