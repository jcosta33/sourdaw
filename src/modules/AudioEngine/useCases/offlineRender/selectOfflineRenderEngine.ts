/**
 * The one place the offline render chooses its engine.
 *
 * As of the D3.c.2 cutover (#2225) the selection is live: a desktop export
 * whose addon answers the graph commands, and whose project the native
 * timeline can hold, renders through `native/offline`
 * (`renderOfflineWithNativeEngine`); everything else renders through
 * `web-audio/offline` (`createOfflineRenderBackend`). Degradation is
 * observable by construction — every web selection carries the reason, and
 * `renderOffline` surfaces the degraded ones on `onWarning`, the export's
 * established warning channel.
 *
 * ── The content gates ──────────────────────────────────────────────────────
 *
 * Each gate names a behaviour only the Web Audio renderer has today, so a
 * project that needs it degrades with a reason instead of exporting into a
 * native refusal:
 *
 *   - **Frozen tracks** replay a pre-rendered buffer through the web strip.
 *   - **Device chains** — a chain renders natively only when every device on
 *     it, bypassed or not, is a built-in the engine builds a body for
 *     (`nativeBuiltinBody`, the renderer's mirror of the engine's own
 *     registry), and the native render carries those bodies' parameter
 *     automation the way the live writer does (#3776). Three exclusions stand:
 *     a device with no native body — a hosted plugin (the offline render has
 *     no engine to host an instance in), a Crumbs sampler (an engine-owned
 *     splice the offline mapper has no lookup for), Faust, Yeast and every
 *     Web Audio-only built-in — would be refused by name or not rendered at
 *     all; an instrument (`isOfflineInstrumentDevice`), because instruments
 *     and Toaster pad routes are scheduled web-side and a native strip would
 *     print a rest; and the target of a sidechain route, because the native
 *     wire has no sidechain vocabulary and a keyed device would print
 *     unkeyed.
 *   - **MIDI programme** — instruments render web-side; a native render of a
 *     MIDI clip would be a rest that reads as a correct file.
 *   - **Clip gain envelopes** — the native wire has no envelope vocabulary
 *     (#2865), so a clip carrying one bounces through the Web Audio renderer
 *     that schedules the drawn curve.
 *   - **Bus-origin sends** — a send whose source strip is a bus (a reverb bus
 *     feeding a parallel compressor bus). The native strip has no send tap on a
 *     bus, so the native producer drops the `add-send` and the mix would print
 *     minus that send's contribution while the Web Audio renderer wires it.
 *     Export fidelity beats speed, so a bus-origin send that would contribute
 *     sends the render to Web Audio with a reason naming both buses. "Would
 *     contribute" is what the Web Audio build and its print reachability make
 *     of the send (`busOriginSendGateReason`): the target is a bus this render
 *     builds, and a post-fader send's source bus is not muted (a pre-fader tap
 *     sits ahead of the mute and survives it). A send the Web Audio build
 *     would skip, or a post-fader one off a muted bus, does not gate. A level
 *     of 0 does not exempt a send: a `send:<busId>` automation lane can raise
 *     it during the render, and selection does not read lanes. Whether the source or target bus itself reaches the print, and
 *     solo gating, are not read here, so those shapes also go web: a wrong
 *     web answer costs speed, a wrong native one drops audio. A native bus send
 *     tap is the follow-up that retires this gate. Live native playback keeps
 *     the drop (`projectLiveGraphTopology`): the engine refuses a bus-source
 *     send by name, and a producer emitting it would decline the whole batch.
 *   - **Bus → track routing** — a bus routed at an ordinary (non-master)
 *     track is still gated here. A bus whose resolved target is the master
 *     track is a mapper-accepted edge into the master strip, so the default
 *     bus output is not this gate.
 *
 * Mute, pan and solo on a bus are not a gate: the native strip holds them
 * (`SetBusMute` / `SetBusSoloGate` / `BusPan`, #3103), and the offline
 * projection already puts that shape on `create-bus-strip`. Mixdown still
 * omits a solo-gated track from `scheduledTracks` rather than solo-gating
 * the strip, matching the web path.
 *
 * The gates admit conservatively: anything they cannot prove native-renderable
 * goes web, because a wrong `web-audio/offline` answer costs speed while a
 * wrong `native/offline` answer costs a failed or unfaithful export.
 */

import { clipHasActiveGainEnvelope, type GainEnvelopeStoreState, type Track } from '#/modules/Arrangement/stores';

import { type NativeGraphTransport } from '../../repositories/nativeGraph/nativeGraphTransport';
import { probeNativeGraphTransport } from '../../repositories/nativeGraph/probeNativeGraphTransport';
import { nativeBuiltinBody } from '../livePlayback/nativeBuiltinBodies';

import { isOfflineInstrumentDevice } from './isOfflineInstrumentDevice';
import { resolveOutputTarget } from './resolveOutputTarget';

export type OfflineRenderEngineSelection =
    | Readonly<{ engine: 'native/offline'; transport: NativeGraphTransport }>
    | Readonly<{
          engine: 'web-audio/offline';
          reason: string;
          /**
           * True when a native engine exists here and was passed over — the
           * caller surfaces those on `onWarning`. False in a browser, where
           * the web renderer is the platform, not a degradation.
           */
          degraded: boolean;
      }>;

/** A sidechain route as the Routing store spells it — only the keyed device matters here. */
export type OfflineRenderSidechainRoute = Readonly<{ targetDeviceId: string }>;

/**
 * The modulator-rack facts the gates read, as the stores spell them. The
 * native engine carries lane automation on device parameters but has no
 * vocabulary for a modulator curve, so any enabled mapping gates to Web Audio
 * — the same conservatism as every gate below.
 */
export type OfflineRenderGateModulator = Readonly<{
    name: string;
    enabled: boolean;
    mappings: readonly unknown[];
}>;

/**
 * The adjustment-layer facts the gates read. A volume/pan layer whose blend is
 * steady across the render folds into the strip state both engines apply; a
 * moving one, and every DSP layer (no native bus), gate to Web Audio.
 */
export type OfflineRenderGateAdjustmentLayer = Readonly<{
    name: string;
    enabled: boolean;
    effectType: string;
    regions: readonly { startBeat: number; endBeat: number }[];
    affectedTrackIds: readonly string[];
    insertionIndex: number;
}>;

export type SelectOfflineRenderEngineInput = Readonly<{
    gainEnvelopes?: GainEnvelopeStoreState['envelopes'];
    /** Every sidechain route the render reads, wired or not. */
    sidechainRoutes: readonly OfflineRenderSidechainRoute[];
    /** Every track this render will build a strip for. */
    renderableTracks: readonly Track[];
    /** The tracks whose programme reaches the mix. */
    scheduledTracks: readonly Track[];
    modulators?: readonly OfflineRenderGateModulator[];
    adjustmentLayers?: readonly OfflineRenderGateAdjustmentLayer[];
}>;

/** Why this track's chain cannot render natively, or `null` when every device on it can. */
function deviceChainGateReason(track: Track, keyedDeviceIds: ReadonlySet<string>): string | null {
    for (const device of track.devices) {
        if (nativeBuiltinBody(device.type) === null) {
            return `track "${track.name}" carries device "${device.type}", which the native render has no body for`;
        }
        // A Grinder whose record carries model digest words is running a real
        // imported .nam capture (#3774). The native body is built from the
        // numeric record alone and has no vocabulary for a loaded network, so
        // a native render would sound the derived substitute — the exact
        // silent substitution #3774 forbids. The Web Audio render loads the
        // model, so the project degrades to it with this reason.
        if (device.type === 'grinder' && device.parameterValues.neuralCustomModelDigest0 !== undefined) {
            return `track "${track.name}" carries device "${device.type}" running an imported neural model, which the native render cannot load`;
        }
        if (isOfflineInstrumentDevice(device.type)) {
            return `track "${track.name}" carries instrument "${device.type}", which renders through Web Audio`;
        }
        if (keyedDeviceIds.has(device.id)) {
            return `track "${track.name}" carries device "${device.type}" keyed by a sidechain, which the native render does not wire`;
        }
    }
    return null;
}

/**
 * Why a bus-origin send keeps this render off the native engine, or `null`
 * when none would contribute. Mirrors what the Web Audio build wires: its
 * `add-send` needs a source strip and a target bus strip this render builds,
 * and taps pre-fader ahead of the strip's mute or post-fader after it
 * (`resolvePrintReachability`). The level is not read: a send at 0 can be
 * raised by its `send:<busId>` automation lane, which selection does not see.
 */
function busOriginSendGateReason(renderableTracks: readonly Track[]): string | null {
    const busesById = new Map(renderableTracks.filter((track) => track.kind === 'bus').map((bus) => [bus.id, bus]));
    for (const source of busesById.values()) {
        for (const send of source.sends) {
            const target = busesById.get(send.busId);
            if (target === undefined) {
                continue;
            }
            if (source.muted && !send.preFader) {
                continue;
            }
            return `bus "${source.name}" sends to bus "${target.name}", which the native engine has no bus send tap for`;
        }
    }
    return null;
}

/**
 * Why the modulator rack or the adjustment-layer stack keeps this render off
 * the native engine, or `null` when neither applies. Mirrors what the Web
 * Audio render carries: a modulator's block-sampled schedule, a DSP layer's
 * bus chain, and a moving volume/pan layer's block curve are all web-only.
 */
/** Live `resolveAffectedTrackIds`: the explicit list, or every track below the stack position. */
function layerAffectsRenderableTracks(
    layer: OfflineRenderGateAdjustmentLayer,
    trackIds: ReadonlySet<string>,
    allTrackIds: readonly string[]
): boolean {
    if (layer.affectedTrackIds.length > 0) {
        return layer.affectedTrackIds.some((trackId) => trackIds.has(trackId));
    }
    return allTrackIds.slice(layer.insertionIndex).some((trackId) => trackIds.has(trackId));
}

function modulationAndLayerGateReason(input: SelectOfflineRenderEngineInput): string | null {
    for (const modulator of input.modulators ?? []) {
        if (modulator.enabled && modulator.mappings.length > 0) {
            return `modulator "${modulator.name}" drives device parameters, which the native render does not carry`;
        }
    }
    const trackIds = new Set(input.renderableTracks.map((track) => track.id));
    const allTrackIds = input.renderableTracks.map((track) => track.id);
    for (const layer of input.adjustmentLayers ?? []) {
        if (!layer.enabled) {
            continue;
        }
        if (!layerAffectsRenderableTracks(layer, trackIds, allTrackIds)) {
            continue;
        }
        // A steady volume/pan layer folds into the strip state the native
        // engine applies like the web one; only a moving one is web-only.
        if (layer.effectType === 'volume' || layer.effectType === 'pan') {
            if (layer.regions.length > 0) {
                return `adjustment layer "${layer.name}" moves across the export, which only the Web Audio render schedules`;
            }
            continue;
        }
        return `adjustment layer "${layer.name}" routes DSP the native engine has no bus for`;
    }
    return null;
}

/** The first gate that holds, or `null` when the native engine can take it. */
function contentGateReason(input: SelectOfflineRenderEngineInput): string | null {
    const { renderableTracks, scheduledTracks } = input;
    const keyedDeviceIds = new Set(input.sidechainRoutes.map((route) => route.targetDeviceId));
    for (const track of renderableTracks) {
        if (track.freezeState.status === 'frozen') {
            return `track "${track.name}" is frozen and replays a pre-rendered buffer`;
        }
        const chainGate = deviceChainGateReason(track, keyedDeviceIds);
        if (chainGate !== null) {
            return chainGate;
        }
    }
    for (const track of scheduledTracks) {
        for (const clip of track.clips) {
            if (clip.muted) {
                continue;
            }
            if (clip.type === 'midi') {
                return `track "${track.name}" plays MIDI programme`;
            }
            // #2865 — the native wire has no envelope vocabulary, so a bounce
            // through it would print an envelope-carrying clip with no curve
            // in it. The Web Audio render applies it, so the project degrades
            // to that renderer with this reason instead. Clip ids survive
            // comping unchanged (the resolver spreads the source clip), so
            // this raw-clips walk cannot miss a comped take's envelope.
            if (clip.type === 'audio' && clipHasActiveGainEnvelope(clip.id, input.gainEnvelopes)) {
                return `track "${track.name}" plays a clip gain envelope the native render does not apply`;
            }
        }
    }
    const busIds = new Set(renderableTracks.filter((track) => track.kind === 'bus').map((track) => track.id));
    const trackIds = new Set(renderableTracks.filter((track) => track.kind !== 'bus').map((track) => track.id));
    for (const track of renderableTracks) {
        if (track.kind !== 'bus') {
            continue;
        }
        const target = resolveOutputTarget({
            outputId: track.outputId,
            busStripIds: busIds,
            trackStripIds: trackIds,
        });
        if (target.kind === 'track' && target.trackId !== 'master') {
            return `bus "${track.name}" routes into a track, which the native engine refuses`;
        }
    }
    return modulationAndLayerGateReason(input) ?? busOriginSendGateReason(renderableTracks);
}

/**
 * The composition decision between the two renderers. Async because the
 * desktop half is a live question — the addon behind the bridge answers an
 * empty mapping probe, or it does not.
 */
export async function selectOfflineRenderEngine(
    input: SelectOfflineRenderEngineInput
): Promise<OfflineRenderEngineSelection> {
    const availability = await probeNativeGraphTransport();
    if (!availability.available) {
        return {
            engine: 'web-audio/offline',
            reason: availability.reason,
            degraded: availability.runtime === 'desktop',
        };
    }
    const gate = contentGateReason(input);
    if (gate !== null) {
        return { engine: 'web-audio/offline', reason: gate, degraded: true };
    }
    return { engine: 'native/offline', transport: availability.transport };
}
