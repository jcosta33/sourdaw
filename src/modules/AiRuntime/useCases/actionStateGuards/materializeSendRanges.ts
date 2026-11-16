import { type AppAction } from '#/utils/handlerContract';

import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { type ProjectContext, type ProjectContextAutomationLane } from '../../models/ProjectContext';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'automateSendRanges' }>;

function isSendLaneTaken(
    lanes: readonly ProjectContextAutomationLane[],
    laneId: string,
    trackId: string,
    busId: string
): boolean {
    return lanes.some(
        (lane) =>
            lane.id === laneId || (!lane.clipId && lane.trackId === trackId && lane.parameterId === `send:${busId}`)
    );
}

type SendRanges = NonNullable<Extract<AppAction, { type: 'automateSendRanges' }>['payload']['ranges']>;

type TailRanges = { status: 'ranges'; ranges: SendRanges } | Extract<MaterializationStep, { status: 'rejected' }>;

function readTailRanges(action: Action, context: ProjectContext, automationLengthBeats: number): TailRanges {
    const sectionsById = new Map((context.sections ?? []).map((section) => [section.id, section]));
    const ranges: SendRanges = [];
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
    return { status: 'ranges', ranges };
}

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
    const tailRanges = readTailRanges(action, context, automationLengthBeats);
    if (tailRanges.status === 'rejected') {
        return tailRanges;
    }
    const { ranges } = tailRanges;
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
            isSendLaneTaken(context.automationLanes ?? [], laneId, trackId, action.payload.busId)
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
