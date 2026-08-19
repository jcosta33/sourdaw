import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction, type DeviceChainTopologySnapshot, type DeviceSnapshot } from '#/utils/handlerContract';

import { getTrackEligibility } from '../../stores/trackEligibility';
import { type Track } from '../../stores/trackStore';
import { getTrackStoreState } from '../getTrackStoreState';
import { runtimeGraphTopology } from '../runtimeGraphTopology';

import { findPresetById } from './findPresetById';
import { materializePresetDevices } from './materializePresetDevices';

type LoadPresetAction = Extract<AppAction, { type: 'loadPreset' }>;

type CompiledLoadPresetActions = Readonly<{
    actions: readonly AppAction[];
    deviceIds: readonly string[];
    groupLabel: string;
    trackId: string;
}>;

type PresetTarget = Readonly<{
    track: Track;
    expectedProjectRevision?: string;
}>;

function nextId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function hasUniqueIds(values: readonly string[]): boolean {
    return new Set(values).size === values.length;
}

function findPresetTarget(trackId: string): PresetTarget | null {
    const matches = (getTrackStoreState()?.tracks ?? []).filter((track) => track.id === trackId);
    const track = matches.length === 1 ? matches[0] : undefined;
    if (
        !track ||
        !getTrackEligibility(track.kind).acceptsDeviceUpdate ||
        !hasUniqueIds(track.devices.map((device) => device.id))
    ) {
        return null;
    }
    return { track, expectedProjectRevision: captureProjectRevision() };
}

function createLoadPresetAction(input: {
    presetId: string;
    trackId: string;
    expectedBefore: DeviceChainTopologySnapshot;
    expectedFrozen: boolean;
    expectedProjectRevision?: string;
    devices: readonly DeviceSnapshot[];
}): LoadPresetAction {
    return {
        type: 'loadPreset',
        payload: {
            presetId: input.presetId,
            trackId: input.trackId,
            expectedBefore: input.expectedBefore,
            ...(input.expectedProjectRevision ? { expectedProjectRevision: input.expectedProjectRevision } : {}),
            expectedFrozen: input.expectedFrozen,
            devices: input.devices,
        },
    };
}

/**
 * Compiles one user preset selection into registered Arrangement actions. A
 * new track is deliberately an `addTrack` + `loadPreset` batch so it shares
 * CRDT admission, history, undo, and collaborator validation with every other
 * project write.
 */
export function compileLoadPresetActions(input: {
    presetId: string;
    trackId?: string;
}): CompiledLoadPresetActions | null {
    const preset = findPresetById(input.presetId);
    const devices = preset ? materializePresetDevices(preset) : null;
    if (!preset || !devices) {
        return null;
    }

    if (input.trackId) {
        const target = findPresetTarget(input.trackId);
        if (!target) {
            return null;
        }
        return {
            actions: [
                createLoadPresetAction({
                    presetId: preset.id,
                    trackId: target.track.id,
                    expectedBefore: runtimeGraphTopology.createNode(target.track),
                    expectedFrozen: target.track.frozen,
                    expectedProjectRevision: target.expectedProjectRevision,
                    devices,
                }),
            ],
            deviceIds: devices.map((device) => device.id),
            groupLabel: `Load preset "${preset.name}"`,
            trackId: target.track.id,
        };
    }

    const trackId = nextId('preset-track');
    const initialDeviceId = preset.trackKind === 'midi' ? nextId('preset-initial-device') : undefined;
    const expectedBefore: DeviceChainTopologySnapshot = {
        id: trackId,
        kind: preset.trackKind,
        devices: initialDeviceId ? [{ id: initialDeviceId, type: 'builtin-synth', parameterIds: [] }] : [],
    };
    const loadAction = createLoadPresetAction({
        presetId: preset.id,
        trackId,
        expectedBefore,
        expectedFrozen: false,
        devices,
    });
    return {
        actions: [
            {
                type: 'addTrack',
                payload: {
                    id: trackId,
                    initialAlternativeId: nextId('preset-alternative'),
                    ...(initialDeviceId ? { initialDeviceId } : {}),
                    name: preset.name,
                    kind: preset.trackKind,
                },
            },
            loadAction,
        ],
        deviceIds: devices.map((device) => device.id),
        groupLabel: `Load preset "${preset.name}"`,
        trackId,
    };
}
