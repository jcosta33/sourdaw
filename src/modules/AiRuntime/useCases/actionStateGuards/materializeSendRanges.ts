import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'automateSendRanges' }>;

export function materializeSendRanges(action: Action, state: MaterializationState): MaterializationStep {
    const { context, tracksById } = state;
    const bus = tracksById.get(action.payload.busId);
    if (!bus || bus.kind !== 'bus') {
        return { status: 'rejected', reason: `Bus is unavailable: ${action.payload.busId}` };
    }
    const [numerator, denominator] = context.timeSignature;
    const beatsPerBar = numerator * (4 / denominator);
    const automationLengthBeats = beatsPerBar * action.payload.tailBars;
    if (!Number.isFinite(automationLengthBeats) || automationLengthBeats <= 0) {
        return { status: 'rejected', reason: 'Send automation requires a finite positive time signature' };
    }
    const sectionsById = new Map((context.sections ?? []).map((section) => [section.id, section]));
    const ranges = [];
    for (const sectionId of action.payload.sectionIds) {
        const section = sectionsById.get(sectionId);
        if (!section || section.endBeat - section.startBeat < automationLengthBeats) {
            return { status: 'rejected', reason: `Section cannot accept send automation: ${sectionId}` };
        }
        ranges.push({
            sectionId,
            sectionName: section.name,
            startBeat: section.startBeat,
            endBeat: section.endBeat,
            automationStartBeat: section.endBeat - automationLengthBeats,
        });
    }
    const expectedTracks = [];
    for (const trackId of action.payload.trackIds) {
        const track = tracksById.get(trackId);
        const send = track?.sends?.find((candidate) => candidate.busId === action.payload.busId);
        const laneId = `auto-send-${encodeURIComponent(trackId)}-${encodeURIComponent(action.payload.busId)}`;
        if (
            !track ||
            track.frozen === true ||
            track.automationMode === 'off' ||
            !send ||
            send.preFader ||
            !Number.isFinite(send.level) ||
            (context.automationLanes ?? []).some(
                (lane) =>
                    lane.id === laneId ||
                    (!lane.clipId && lane.trackId === trackId && lane.parameterId === `send:${action.payload.busId}`)
            )
        ) {
            return { status: 'rejected', reason: `Track cannot accept send automation: ${trackId}` };
        }
        expectedTracks.push({
            trackId,
            trackName: track.name,
            frozen: track.frozen ?? false,
            automationMode: track.automationMode,
            sendLevel: send.level,
            sendPreFader: send.preFader,
        });
    }
    return {
        status: 'accepted',
        actions: [
            {
                type: 'automateSendRanges',
                payload: {
                    ...action.payload,
                    busName: bus.name,
                    expectedTimeSignature: [numerator, denominator],
                    ranges,
                    expectedTracks,
                },
            },
        ],
    };
}
