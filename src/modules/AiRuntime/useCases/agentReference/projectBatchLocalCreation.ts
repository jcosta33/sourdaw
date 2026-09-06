import {
    type ProjectContext,
    type ProjectContextDeviceParameter,
    type ProjectContextTrack,
} from '../../models/ProjectContext';

import { type BatchLocalCreatedTrackKind } from './batchLocalBindingProducers';

export type BatchLocalCreationProjection =
    | {
          createdId: string;
          initialDeviceId?: string;
          kind: 'track';
          name: string;
          trackKind: BatchLocalCreatedTrackKind;
      }
    | {
          createdId: string;
          endBeat: number;
          kind: 'clip';
          name: string;
          parentTrackId: string;
          startBeat: number;
      }
    | {
          afterDeviceId?: string;
          createdId: string;
          deviceType: string;
          kind: 'device';
          name: string;
          parameters: readonly ProjectContextDeviceParameter[];
          parentTrackId: string;
      };

function createProjectedTrack(
    context: ProjectContext,
    projection: BatchLocalCreationProjection,
    kind: BatchLocalCreatedTrackKind
): ProjectContextTrack {
    const devices =
        kind === 'midi' && projection.kind === 'track' && projection.initialDeviceId !== undefined
            ? [
                  {
                      id: projection.initialDeviceId,
                      name: 'Synth',
                      type: 'builtin-synth',
                      bypassed: false,
                      parameters: [],
                  },
              ]
            : [];
    return {
        id: projection.createdId,
        name: projection.name,
        kind,
        muted: false,
        soloed: false,
        soloSafe: kind === 'bus',
        armed: false,
        frozen: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        outputId: context.tracks.find((track) => track.kind === 'master')?.id ?? 'master',
        clipCount: 0,
        deviceCount: devices.length,
        clips: [],
        devices,
        sends: [],
    };
}

function projectCreatedClip(
    context: ProjectContext,
    projection: Extract<BatchLocalCreationProjection, { kind: 'clip' }>
): ProjectContext {
    return {
        ...context,
        tracks: context.tracks.map((track) => {
            if (track.id !== projection.parentTrackId) {
                return track;
            }
            const clips = [
                ...track.clips,
                {
                    id: projection.createdId,
                    name: projection.name,
                    type: track.kind === 'midi' ? ('midi' as const) : ('audio' as const),
                    startBeat: projection.startBeat,
                    endBeat: projection.endBeat,
                    locked: false,
                    noteCount: 0,
                },
            ];
            return { ...track, clips, clipCount: clips.length };
        }),
    };
}

function projectCreatedDevice(
    context: ProjectContext,
    projection: Extract<BatchLocalCreationProjection, { kind: 'device' }>
): ProjectContext {
    return {
        ...context,
        tracks: context.tracks.map((track) => {
            if (track.id !== projection.parentTrackId) {
                return track;
            }
            const insertionIndex =
                projection.afterDeviceId === undefined
                    ? track.devices.length
                    : track.devices.findIndex((device) => device.id === projection.afterDeviceId) + 1;
            if (insertionIndex <= 0 && projection.afterDeviceId !== undefined) {
                return track;
            }
            const devices = [...track.devices];
            devices.splice(insertionIndex, 0, {
                bypassed: false,
                id: projection.createdId,
                name: projection.name,
                parameters: projection.parameters.map((parameter) => ({ ...parameter })),
                type: projection.deviceType,
            });
            return { ...track, devices, deviceCount: devices.length };
        }),
    };
}

/**
 * Makes a plan-created object visible to every later concrete capability check in the same batch,
 * so a consumer is grounded against the object the plan will actually produce rather than against
 * a snapshot that predates it. The projected shape mirrors what the creating handler writes.
 */
export function projectBatchLocalCreation(
    context: ProjectContext,
    projection: BatchLocalCreationProjection
): ProjectContext {
    if (projection.kind === 'clip') {
        return projectCreatedClip(context, projection);
    }
    if (projection.kind === 'device') {
        return projectCreatedDevice(context, projection);
    }
    return { ...context, tracks: [...context.tracks, createProjectedTrack(context, projection, projection.trackKind)] };
}
