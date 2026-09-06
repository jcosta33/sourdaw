/**
 * Which engine sounds each track strip, and why (#3564).
 *
 * Sourdaw runs two audio carriers at once while the native engine is still
 * growing: the native live graph, which hosts external plugins and plays a real
 * timeline, and Web Audio, which hosts every WASM built-in, every synth and
 * every live input. The law below is the whole of the split, and it is per
 * strip rather than a global switch because a single project mixes both kinds:
 * a master switch onto the native engine would silence the synth track beside
 * the plugin track, and a master switch back would silence the plugin.
 *
 * A track is `native` only when the native engine can represent everything that
 * reaches the speakers through it — its own chain, the path its output takes,
 * and every bus it sends into. Anything short of that is `web`, with the reason
 * carried alongside, because the reason is what the app tells the musician when
 * a plugin cannot be heard. Guessing is not an option in either direction: a
 * track marked native the engine cannot build goes silent, and a track left on
 * Web Audio the engine also plays is heard twice.
 *
 * "Everything that reaches the speakers" covers what a strip *sounds*, not only
 * what it processes. A hosted plugin is the one device on a chain that has a
 * native body and only a native body — Web Audio builds nothing for it, and the
 * engine splices an instrument plugin into the chain as a generator (#3826) —
 * so a strip holding an attached plugin can sound with no clip under the
 * playhead at all. That is why rule 1 asks about the chain as well as the
 * programme; {@link firstFailure} states the order the two are weighed in.
 *
 * Buses get no entry. They are shared: a native-carried track feeds the native
 * bus while a web-carried one feeds the Web Audio bus of the same name, and the
 * two sum at the hardware output. That is what makes the split per track
 * possible at all, and it is also why a track whose *bus* holds something the
 * native engine cannot build stays on Web Audio — the native side would play it
 * through a bus missing that processing.
 */

import { type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphDeviceChain } from '../../models/AudioGraphBackend';
import { resolveOutputTarget } from '../offlineRender/resolveOutputTarget';

import { admittedSendBusIds } from './admittedSendBusIds';
import { isHostedPluginDevice } from './isHostedPluginDevice';
import { nativeBuiltinBody } from './nativeBuiltinBodies';
import { type LiveGraphProgramme } from './projectLiveGraphProgramme';

/**
 * The engine that sounds one track strip. A `web` carrier states why, because a
 * silent plugin with no account of itself is indistinguishable from a defect.
 */
export type StripCarrier = Readonly<{ carrier: 'native' }> | Readonly<{ carrier: 'web'; reason: string }>;

export type StripCarriersInput = Readonly<{
    /** Every track and bus the live engine builds a strip for, in project order. */
    stripTracks: readonly Track[];
    /** The external plugin instances the native engine currently owns. */
    attachedInstanceIds: ReadonlySet<string>;
    /** What each strip plays, from {@link projectLiveGraphProgramme}. */
    programme: LiveGraphProgramme;
    /** The tracks whose Web Audio strip is receiving a live input signal. */
    inputMonitoredTrackIds: ReadonlySet<string>;
}>;

/**
 * Whether the native engine can build a body for this device.
 *
 * A built-in is answered from `nativeBuiltinBodies`, which is the renderer's
 * mirror of the engine's own registry and states why it must stay one. This
 * module reads that registry rather than restating it, because its whole job is
 * to answer for a batch the engine takes: a second, looser reading of what is
 * representable is how `contributesAudio` starts refusing sessions.
 *
 * An externally hosted plugin is the one device whose answer is not a property
 * of the project at all: `map_device` splices in the engine-owned instance the
 * native side already holds, so such a device has a body exactly when the
 * engine reports the instance attached — which is why the attach state is an
 * input rather than a rule.
 */
function hasNativeBody(device: AudioGraphDeviceChain[number], attachedInstanceIds: ReadonlySet<string>): boolean {
    const externalInstanceId = device.externalInstanceId;
    if (externalInstanceId !== undefined) {
        return attachedInstanceIds.has(externalInstanceId);
    }
    // An external plugin the host has not resolved to an instance names nothing
    // the engine could be holding, so no attach state can answer for it.
    if (device.externalPluginId !== undefined) {
        return false;
    }
    return nativeBuiltinBody(device.type) !== null;
}

/** The first strip on a route the native engine cannot build, and what stopped it. */
type PathObstruction =
    Readonly<{ kind: 'device'; stripName: string; device: AudioGraphDeviceChain[number] }> | Readonly<{ kind: 'loop' }>;

type CarrierContext = Readonly<{
    stripById: ReadonlyMap<string, Track>;
    busStripIds: ReadonlySet<string>;
    trackStripIds: ReadonlySet<string>;
    attachedInstanceIds: ReadonlySet<string>;
    programme: LiveGraphProgramme;
}>;

/** How a device that stops a route is named to the musician. */
function deviceLabel(device: AudioGraphDeviceChain[number]): string {
    return isHostedPluginDevice(device) ? `plugin "${device.name}", not attached to the engine` : device.type;
}

/** Why a device on this strip's own chain has no native body. */
function chainReason(device: AudioGraphDeviceChain[number]): string {
    return isHostedPluginDevice(device)
        ? `plugin "${device.name}" is not attached to the engine`
        : `device ${device.type} has no native body`;
}

/**
 * The devices the engine is asked to build for this strip.
 *
 * A frozen strip's bake already contains the processing (see
 * `projectLiveGraphProgramme`), so its chain is dropped rather than judged —
 * both faithful and trivially representable.
 */
function chainOf(track: Track, context: CarrierContext): AudioGraphDeviceChain {
    return context.programme.bakedStripIds.has(track.id) ? [] : track.devices;
}

/**
 * Whether this strip's own chain names an externally hosted plugin instance
 * the engine reports attached.
 *
 * Only an attached plugin counts, never a built-in body. A built-in effect
 * processes an input and generates nothing on its own, so it gives a clip-less
 * strip nothing to sound; a built-in instrument would, but the engine addresses
 * a strip's notes to a plugin instance, so no note reaches one yet and a strip
 * whose only body is a built-in instrument is still a strip nothing sounds
 * (#3893).
 */
function hostsAttachedPlugin(track: Track, context: CarrierContext): boolean {
    return chainOf(track, context).some(
        (device) =>
            device.externalInstanceId !== undefined && context.attachedInstanceIds.has(device.externalInstanceId)
    );
}

/**
 * The rule-1 reason a strip with no native playback stays on Web Audio, or
 * `null` when rule 1 passes it. Read in the order the code checks it:
 *
 * - No attached plugin on the chain: `'nothing scheduled'` — nothing native is
 *   scheduled and no attached plugin gives the strip a native body, so Web
 *   Audio keeps whatever the strip plays and no plugin notice is owed.
 * - The strip is in `programme.webVoicedStripIds`: `'its clips play on Web
 *   Audio'` — Web Audio is already voicing this strip's clips, so carrying it
 *   natively would silence them with no notice given. A MIDI strip whose
 *   instrument the engine holds is absent from that set, because the engine
 *   voices its notes through `schedule-midi` (#3892).
 * - Otherwise `null`: the attached plugin is uncontested, so it carries the
 *   strip natively with no clip under the playhead at all.
 */
function webReasonWithoutNativePlayback(track: Track, context: CarrierContext): string | null {
    if (!hostsAttachedPlugin(track, context)) {
        return 'nothing scheduled';
    }
    return context.programme.webVoicedStripIds.has(track.id) ? 'its clips play on Web Audio' : null;
}

function chainObstruction(track: Track, context: CarrierContext): AudioGraphDeviceChain[number] | null {
    return chainOf(track, context).find((device) => !hasNativeBody(device, context.attachedInstanceIds)) ?? null;
}

/**
 * The first thing between this strip and the master output the native engine
 * cannot build, following the route the way the producer's own
 * `resolveOutputTarget` follows it.
 *
 * `visited` is the cycle guard: a project can route a track into a bus that
 * routes back, and a recursion with no memory of where it has been would never
 * return.
 */
function outputPathObstruction(
    track: Track,
    context: CarrierContext,
    visited: ReadonlySet<string>
): PathObstruction | null {
    const target = resolveOutputTarget({
        outputId: track.outputId,
        busStripIds: context.busStripIds,
        trackStripIds: context.trackStripIds,
    });
    if (target.kind === 'master') {
        return null;
    }
    return stripObstruction(target.kind === 'bus' ? target.busId : target.trackId, context, visited);
}

/** This strip's own chain, then whatever its own output reaches, recursively. */
function stripObstruction(
    stripId: string,
    context: CarrierContext,
    visited: ReadonlySet<string>
): PathObstruction | null {
    if (visited.has(stripId)) {
        return { kind: 'loop' };
    }
    const strip = context.stripById.get(stripId);
    if (!strip) {
        // `resolveOutputTarget` only names strips this session built, so an id
        // it returned is always one of them.
        return null;
    }
    const device = chainObstruction(strip, context);
    if (device) {
        return { kind: 'device', stripName: strip.name, device };
    }
    return outputPathObstruction(strip, context, new Set(visited).add(stripId));
}

function obstructionReason(obstruction: PathObstruction, lead: string): string {
    return obstruction.kind === 'loop'
        ? 'output path loops'
        : `${lead} "${obstruction.stripName}" holds ${deviceLabel(obstruction.device)}`;
}

/**
 * The first rule this track fails, in the order the rules are stated, or `null`
 * when it passes every one of them.
 *
 * Order is the contract, not an implementation detail: the reason a musician
 * reads has to be the first thing that is actually wrong, and a track with no
 * clips on it is not "missing a plugin".
 *
 * Rule 1 reads the programme first, exactly as the code does: a strip the
 * programme scheduled native playback for passes rule 1 outright. Only a
 * strip with no native playback falls to
 * {@link webReasonWithoutNativePlayback}, whose guards state the one
 * exception — an attached plugin gives a strip something to sound only when
 * nothing on the Web Audio path still voices that strip, which the programme's
 * own `webVoicedStripIds` is the record of.
 */
function firstFailure(
    track: Track,
    context: CarrierContext,
    inputMonitoredTrackIds: ReadonlySet<string>
): string | null {
    const plays = (context.programme.playbacksByStripId.get(track.id)?.length ?? 0) > 0;
    if (!plays) {
        const webReason = webReasonWithoutNativePlayback(track, context);
        if (webReason) {
            return webReason;
        }
    }
    if (inputMonitoredTrackIds.has(track.id)) {
        // The live input reaches the Web Audio strip and nothing else, so
        // closing that strip's exits would silence what the musician is playing.
        return 'input monitoring is on';
    }
    const device = chainObstruction(track, context);
    if (device) {
        return chainReason(device);
    }
    const seen = new Set([track.id]);
    const routed = outputPathObstruction(track, context, seen);
    if (routed) {
        return obstructionReason(routed, 'output path through');
    }
    for (const busId of admittedSendBusIds({ track, busStripIds: context.busStripIds })) {
        const sent = stripObstruction(busId, context, seen);
        if (sent) {
            return obstructionReason(sent, 'send to');
        }
    }
    return null;
}

/**
 * The carrier of every track strip in this session, keyed by track id.
 *
 * Pure, and the single place the law lives: the producer reads it to decide
 * which strips the native batch builds as contributing audio, and the session
 * reads it to say which plugins a musician will not be able to hear.
 */
export function projectStripCarriers(input: StripCarriersInput): ReadonlyMap<string, StripCarrier> {
    const { stripTracks, attachedInstanceIds, programme, inputMonitoredTrackIds } = input;
    const context: CarrierContext = {
        stripById: new Map(stripTracks.map((track): [string, Track] => [track.id, track])),
        busStripIds: new Set(stripTracks.filter((track) => track.kind === 'bus').map((track) => track.id)),
        trackStripIds: new Set(stripTracks.filter((track) => track.kind !== 'bus').map((track) => track.id)),
        attachedInstanceIds,
        programme,
    };
    const carriers = new Map<string, StripCarrier>();
    for (const track of stripTracks) {
        if (track.kind === 'bus') {
            continue;
        }
        const reason = firstFailure(track, context, inputMonitoredTrackIds);
        carriers.set(track.id, reason === null ? { carrier: 'native' } : { carrier: 'web', reason });
    }
    return carriers;
}
