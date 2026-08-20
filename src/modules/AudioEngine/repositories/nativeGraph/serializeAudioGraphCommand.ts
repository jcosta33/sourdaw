/**
 * The wire half of the native `AudioGraphBackend`: contract commands onto the
 * JSON payload `crates/sourdaw-native/src/commands/graph.rs` deserializes.
 *
 * This file is the hand-maintained TS side of that crate's wire mirror
 * (`GraphBatchPayload` and friends). Command-level fields are mapped
 * explicitly, so a field the contract grows does not cross this wire until
 * someone decides it does, here, against the Rust mirror — with one deliberate
 * exception: the leaf shapes whose contract type *is* the wire type
 * (`command.state`, `command.target`, `command.write`, and a device's
 * `parameterValues`) are spread. Those are primitive-valued records today, so
 * a spread copies exactly what the Rust mirror deserializes; the hazard it
 * leaves open is that a field grown onto one of those leaf types crosses
 * silently until `graph.rs` (which ignores unknown fields) is taught to read
 * it. The spellings are the contract's own — kebab-case `kind`/`shape` tags,
 * camelCase fields — because `graph.rs` was written to deserialize the
 * contract shape directly.
 *
 * Exactly two things change between the contract and the wire:
 *
 * - `source.buffer` is stripped. The `AudioBuffer` is the *web* realisation
 *   of the material and cannot cross an IPC boundary; only the identity does
 *   (`AudioGraphClipSource` states this law). The backend registers the
 *   buffer's PCM under `sourceId` through `register_timeline_sample` before
 *   the batch is applied — `collectBufferedClipSources` is the collection
 *   half of that.
 * - `Device.deviceState` is dropped. It is opaque project-owned state for the
 *   web offline hydrator; the native side ignores unknown fields, but an
 *   opaque value is not guaranteed to be structured-cloneable, so it never
 *   enters the payload at all.
 *
 * This module is pure and transport-free on purpose: the production backend
 * serializes through it over the desktop bridge, and the null test drives the
 * built addon in-process through the very same function — the serializer is
 * the unit the null test proves, and only the transport differs between the
 * two.
 */

import {
    type AudioGraphClipFade,
    type AudioGraphClipPlayback,
    type AudioGraphCommand,
    type AudioGraphCorrelation,
    type AudioGraphDeviceParameterTarget,
    type AudioGraphParameterWrite,
    type AudioGraphRouteTarget,
    type AudioGraphSendTap,
    type AudioGraphStepWrite,
    type AudioGraphStripParameterTarget,
    type AudioGraphStripState,
} from '../../models/AudioGraphBackend';
import { type Device } from '../../models/TrackViewTypes';

/** `DevicePayload` in `graph.rs`: project truth minus the opaque state. */
export type NativeGraphWireDevice = Readonly<{
    id: string;
    name: string;
    type: string;
    bypassed: boolean;
    parameterValues: Readonly<Record<string, number>>;
    externalPluginId?: string;
    externalInstanceId?: string;
}>;

/** `ClipSourcePayload` in `graph.rs`: the identity, never the realisation. */
export type NativeGraphWireClipSource = Readonly<{ sourceId: string }>;

/** `ClipPlaybackPayload` in `graph.rs`. */
export type NativeGraphWireClipPlayback = Readonly<{
    trackId: string;
    source: NativeGraphWireClipSource;
    startTime: number;
    sourceOffsetSeconds: number;
    durationSeconds: number;
    playbackRate: number;
    gain: number;
    fade: AudioGraphClipFade;
}>;

/**
 * `GraphCommandPayload` in `graph.rs`. Everything the contract already states
 * in wire-safe terms is carried by its contract type; only the two variants
 * whose payload differs from the contract (`Device`, the clip source) name
 * wire types of their own.
 */
export type NativeGraphWireCommand =
    | Readonly<{
          kind: 'create-track-strip';
          trackId: string;
          name: string;
          state: AudioGraphStripState;
          devices: readonly NativeGraphWireDevice[];
          honorMuted: boolean;
          contributesAudio: boolean;
      }>
    | Readonly<{
          kind: 'create-bus-strip';
          busId: string;
          name: string;
          state: AudioGraphStripState;
          devices: readonly NativeGraphWireDevice[];
          honorMuted: boolean;
          contributesAudio: boolean;
      }>
    | Readonly<{ kind: 'set-track-output'; trackId: string; target: AudioGraphRouteTarget }>
    | Readonly<{ kind: 'add-send'; trackId: string; busId: string; tap: AudioGraphSendTap; level: number }>
    | Readonly<{ kind: 'remove-send'; trackId: string; busId: string }>
    | Readonly<{ kind: 'insert-device'; trackId: string; device: NativeGraphWireDevice; index: number }>
    | Readonly<{ kind: 'remove-device'; trackId: string; deviceId: string }>
    | Readonly<{ kind: 'write-parameter'; target: AudioGraphStripParameterTarget; write: AudioGraphParameterWrite }>
    | Readonly<{ kind: 'write-device-parameter'; target: AudioGraphDeviceParameterTarget; write: AudioGraphStepWrite }>
    | Readonly<{ kind: 'schedule-clip'; playback: NativeGraphWireClipPlayback }>
    | Readonly<{ kind: 'set-transport'; playing: boolean; positionSeconds: number }>;

/** `GraphBatchPayload` in `graph.rs`. */
export type NativeGraphWireBatch = Readonly<{
    schemaVersion: 1;
    correlation?: AudioGraphCorrelation;
    commands: readonly NativeGraphWireCommand[];
}>;

function serializeDevice(device: Device): NativeGraphWireDevice {
    return {
        id: device.id,
        name: device.name,
        type: device.type,
        bypassed: device.bypassed,
        parameterValues: { ...device.parameterValues },
        ...(device.externalPluginId !== undefined ? { externalPluginId: device.externalPluginId } : {}),
        ...(device.externalInstanceId !== undefined ? { externalInstanceId: device.externalInstanceId } : {}),
    };
}

function serializeFade(fade: AudioGraphClipFade): AudioGraphClipFade {
    return {
        ...(fade.fadeIn
            ? { fadeIn: fade.fadeIn.reachesFullAt !== undefined ? { reachesFullAt: fade.fadeIn.reachesFullAt } : {} }
            : {}),
        ...(fade.fadeOut
            ? { fadeOut: fade.fadeOut.beginsAt !== undefined ? { beginsAt: fade.fadeOut.beginsAt } : {} }
            : {}),
        microFadeSeconds: fade.microFadeSeconds,
    };
}

function serializePlayback(playback: AudioGraphClipPlayback): NativeGraphWireClipPlayback {
    return {
        trackId: playback.trackId,
        // The one deliberate omission in this file: the buffer stays behind.
        source: { sourceId: playback.source.sourceId },
        startTime: playback.startTime,
        sourceOffsetSeconds: playback.sourceOffsetSeconds,
        durationSeconds: playback.durationSeconds,
        playbackRate: playback.playbackRate,
        gain: playback.gain,
        fade: serializeFade(playback.fade),
    };
}

export function serializeAudioGraphCommand(command: AudioGraphCommand): NativeGraphWireCommand {
    switch (command.kind) {
        case 'create-track-strip':
            return {
                kind: 'create-track-strip',
                trackId: command.trackId,
                name: command.name,
                state: { ...command.state },
                devices: command.devices.map(serializeDevice),
                honorMuted: command.honorMuted,
                contributesAudio: command.contributesAudio,
            };
        case 'create-bus-strip':
            return {
                kind: 'create-bus-strip',
                busId: command.busId,
                name: command.name,
                state: { ...command.state },
                devices: command.devices.map(serializeDevice),
                honorMuted: command.honorMuted,
                contributesAudio: command.contributesAudio,
            };
        case 'set-track-output':
            return { kind: 'set-track-output', trackId: command.trackId, target: { ...command.target } };
        case 'add-send':
            return {
                kind: 'add-send',
                trackId: command.trackId,
                busId: command.busId,
                tap: command.tap,
                level: command.level,
            };
        case 'remove-send':
            return { kind: 'remove-send', trackId: command.trackId, busId: command.busId };
        case 'insert-device':
            return {
                kind: 'insert-device',
                trackId: command.trackId,
                device: serializeDevice(command.device),
                index: command.index,
            };
        case 'remove-device':
            return { kind: 'remove-device', trackId: command.trackId, deviceId: command.deviceId };
        case 'write-parameter':
            return { kind: 'write-parameter', target: { ...command.target }, write: { ...command.write } };
        case 'write-device-parameter':
            return { kind: 'write-device-parameter', target: { ...command.target }, write: { ...command.write } };
        case 'schedule-clip':
            return { kind: 'schedule-clip', playback: serializePlayback(command.playback) };
        case 'set-transport':
            return { kind: 'set-transport', playing: command.playing, positionSeconds: command.positionSeconds };
    }
    // Unreachable while the switch covers the union. Typed `never` so a command
    // added to the contract fails the typecheck here rather than crossing the
    // wire in a shape the Rust mirror never agreed to.
    const unhandled: never = command;
    throw new Error(`unhandled command: ${JSON.stringify(unhandled)}`);
}
