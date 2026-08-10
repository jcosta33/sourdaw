import { getNotesForClip } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type MaterializableRuntimeAction } from '../models/ExecutableRuntimeAction';
import { projectMidiArticulationTransfer } from '../transformers/projectMidiArticulationTransfer';

import { type ProjectContext } from './getProjectContext';

type MaterializeActionStateGuardsResult =
    { status: 'accepted'; actions: AppAction[] } | { status: 'rejected'; reason: string };

export function materializeActionStateGuards(
    actions: readonly MaterializableRuntimeAction[],
    context: ProjectContext
): MaterializeActionStateGuardsResult {
    const tracksById = new Map(context.tracks.map((track) => [track.id, track]));
    const frozenByTrack = new Map(context.tracks.map((track) => [track.id, track.frozen] as const));
    const reservedDeviceIds = new Set(context.tracks.flatMap((track) => track.devices.map((device) => device.id)));
    const deviceIdsByTrack = new Map(
        context.tracks.map((track) => [track.id, track.devices.map((device) => device.id)] as const)
    );
    const materialized: AppAction[] = [];

    for (const action of actions) {
        if (action.type === 'copyMidiArticulations') {
            const sourceTarget = context.tracks.flatMap((track) =>
                track.clips.filter((clip) => clip.id === action.payload.sourceClipId).map((clip) => ({ clip, track }))
            )[0];
            const targetTarget = context.tracks.flatMap((track) =>
                track.clips.filter((clip) => clip.id === action.payload.targetClipId).map((clip) => ({ clip, track }))
            )[0];
            if (
                !sourceTarget ||
                !targetTarget ||
                sourceTarget.track.id !== targetTarget.track.id ||
                sourceTarget.track.frozen === true ||
                sourceTarget.clip.type !== 'midi' ||
                targetTarget.clip.type !== 'midi' ||
                sourceTarget.clip.locked === true ||
                targetTarget.clip.locked === true
            ) {
                return { status: 'rejected', reason: 'MF-03 clip pair is unavailable or protected' };
            }
            const expectedSourceNotes = getNotesForClip(action.payload.sourceClipId).map((note) => ({ ...note }));
            const expectedTargetNotes = getNotesForClip(action.payload.targetClipId).map((note) => ({ ...note }));
            const projectedPairs = projectMidiArticulationTransfer({
                sourceNotes: expectedSourceNotes,
                targetNotes: expectedTargetNotes,
            });
            if (!projectedPairs) {
                return { status: 'rejected', reason: 'MF-03 note topology is incomplete or ambiguous' };
            }
            materialized.push({
                type: 'copyMidiArticulations',
                payload: {
                    trackId: sourceTarget.track.id,
                    sourceClipId: action.payload.sourceClipId,
                    targetClipId: action.payload.targetClipId,
                    notePairs: projectedPairs.map((pair) => ({
                        sourceNoteId: pair.sourceNoteId,
                        targetNoteId: pair.targetNoteId,
                    })),
                    expectedSourceNotes,
                    expectedTargetNotes,
                },
            });
            continue;
        }
        if (action.type === 'setTrackGain') {
            const track = tracksById.get(action.payload.trackId);
            if (!track) {
                return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
            }
            materialized.push({
                type: 'setTrackGain',
                payload: { ...action.payload, expectedGain: track.gain },
            });
            continue;
        }
        if (action.type === 'setTrackPan') {
            const track = tracksById.get(action.payload.trackId);
            if (!track) {
                return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
            }
            materialized.push({
                type: 'setTrackPan',
                payload: { ...action.payload, expectedPan: track.pan },
            });
            continue;
        }
        if (action.type === 'muteTrack') {
            const track = tracksById.get(action.payload.trackId);
            if (!track) {
                return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
            }
            materialized.push({
                type: 'muteTrack',
                payload: { ...action.payload, expectedMuted: track.muted },
            });
            continue;
        }
        if (action.type === 'addDevice') {
            const expectedFrozen = frozenByTrack.get(action.payload.trackId);
            if (expectedFrozen === undefined) {
                return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
            }
            if (expectedFrozen) {
                return { status: 'rejected', reason: `Track is frozen: ${action.payload.trackId}` };
            }
            const expectedDeviceIds = deviceIdsByTrack.get(action.payload.trackId);
            if (!expectedDeviceIds) {
                return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
            }
            const baseDeviceId = `device-ai-${action.payload.trackId}-${action.payload.deviceType}`;
            let deviceId = baseDeviceId;
            let suffix = 2;
            while (reservedDeviceIds.has(deviceId)) {
                deviceId = `${baseDeviceId}-${String(suffix)}`;
                suffix += 1;
            }
            reservedDeviceIds.add(deviceId);
            const nextDeviceIds = [...expectedDeviceIds];
            let insertionIndex = nextDeviceIds.length;
            if (action.payload.afterDeviceId) {
                const anchorIndex = nextDeviceIds.indexOf(action.payload.afterDeviceId);
                if (anchorIndex < 0) {
                    return {
                        status: 'rejected',
                        reason: `Device is unavailable: ${action.payload.afterDeviceId}`,
                    };
                }
                insertionIndex = anchorIndex + 1;
            }
            nextDeviceIds.splice(insertionIndex, 0, deviceId);
            deviceIdsByTrack.set(action.payload.trackId, nextDeviceIds);
            materialized.push({
                type: 'addDevice',
                payload: {
                    ...action.payload,
                    deviceId,
                    expectedDeviceIds,
                    expectedFrozen,
                },
            });
            continue;
        }
        if (action.type === 'createBus' && action.payload.busId) {
            deviceIdsByTrack.set(action.payload.busId, []);
            frozenByTrack.set(action.payload.busId, false);
        }
        if (action.type === 'automateSendRange') {
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
            materialized.push({
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
            });
            continue;
        }
        if (action.type === 'automateTrackGainRange') {
            const section = (context.sections ?? []).find(
                (candidate) => candidate.name.toLocaleLowerCase() === action.payload.sectionName.toLocaleLowerCase()
            );
            if (!section) {
                return { status: 'rejected', reason: `Section is unavailable: ${action.payload.sectionName}` };
            }
            const expectedTracks = [];
            for (const trackId of action.payload.trackIds) {
                const track = tracksById.get(trackId);
                if (!track || track.kind !== 'bus') {
                    return { status: 'rejected', reason: `Impact bus is unavailable: ${trackId}` };
                }
                if (
                    track.frozen === true ||
                    track.automationMode === 'off' ||
                    !Number.isFinite(track.gain) ||
                    track.gain <= 0 ||
                    track.gain * 10 ** (action.payload.gainDb / 20) > 1 ||
                    (context.automationLanes ?? []).some(
                        (lane) =>
                            lane.id === `auto-gain-${encodeURIComponent(trackId)}` ||
                            (!lane.clipId && lane.trackId === trackId && lane.parameterId === 'gain')
                    )
                ) {
                    return { status: 'rejected', reason: `Impact bus cannot accept gain automation: ${trackId}` };
                }
                expectedTracks.push({
                    trackId,
                    trackName: track.name,
                    gain: track.gain,
                    automationMode: track.automationMode,
                    frozen: track.frozen ?? false,
                });
            }
            materialized.push({
                type: 'automateTrackGainRange',
                payload: {
                    ...action.payload,
                    sectionId: section.id,
                    startBeat: section.startBeat,
                    endBeat: section.endBeat,
                    expectedTracks,
                    expectedSection: {
                        name: section.name,
                        startBeat: section.startBeat,
                        endBeat: section.endBeat,
                    },
                },
            });
            continue;
        }
        materialized.push(action);
    }

    return { status: 'accepted', actions: materialized };
}
