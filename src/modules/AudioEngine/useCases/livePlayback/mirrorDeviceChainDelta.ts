/**
 * Mirror one device-chain change onto the rolling native engine (#3575).
 *
 * Web Audio takes a chain edit the moment it is committed. Before this, a
 * native session took it only on the next play, because the only route into the
 * engine's graph was the whole-topology batch a play sends — and a topology
 * batch tears every strip down inside its own fence, which is not a thing that
 * may reach a rolling engine. So an engineer who added a compressor mid-take
 * heard it on one carrier and not the other.
 *
 * The mapper already speaks `insert-device` and `remove-device`, and both go
 * through the ordinary fence. One batch per change is therefore enough: the
 * engine applies it whole at a block boundary, or applies none of it.
 *
 * ── What it is not ────────────────────────────────────────────────────────
 *
 * It is not a carrier decision. Which carrier sounds a strip is fixed by the
 * play batch, and a mid-roll change the native strip cannot host — an
 * unbuildable device on a contributing strip — is *declined*, not re-carried:
 * the engineer is told it takes effect on the next play, when the carrier law
 * reads the new chain (ADR 0044's fifth accepted cost).
 *
 * It is not a failure route either. The Web Audio delta has already landed by
 * the time this runs, and a native decline is not a runtime-graph failure — so
 * the caller fires it and forgets it, and nothing here throws into a project
 * mutation.
 *
 * ── A changed bank key rebuilds the device in place (#4203) ───────────────
 *
 * A device that keeps its id and position but now projects a different
 * `sampleBankKey` — a musician picked another Levain instrument mid-take — is
 * neither an insert nor a removal by id, so the ordinary diff sees no change
 * to mirror. But the engine's instance was built from the bank its `insert-
 * device` named, and holds no door to change which bank that is: the only way
 * to give a held strip a different instrument is to tear its device down and
 * build it again, from the bank the new choice names. `editChain` therefore
 * treats such a device as swapped — a `remove-device` immediately followed by
 * an `insert-device` at the position it already holds — rather than leaving
 * it to the next play.
 *
 * ── Indices are the engine's, not the project's ───────────────────────────
 *
 * Every index is counted against the chain the engine reports it holds, never
 * against the project chain: a device the mapper degraded is absent natively,
 * and an index that counted it would put the new device on the wrong side of
 * its neighbour.
 */

import { type Device, type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphCommand } from '../../models/AudioGraphBackend';

import { isHostedPluginDevice } from './isHostedPluginDevice';
import { latchedPedalCommands } from './latchedPedalCommands';
import { nativeBuiltinBody } from './nativeBuiltinBodies';
import { nativeInsertIndex } from './nativeChainIndex';
import { nativeEnginePlayheadFeed } from './nativeEnginePlayheadFeedState';
import { nativeLiveAutomationWriter } from './nativeLiveAutomationWriterState';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { notifyDeferredChainChange } from './notifyDeferredChainChange';
// A re-inserted chain reaches `map_device` under the strip's `contributes_audio`,
// which refuses the whole batch by device and key over one camelCase id it does
// not hold a vocabulary for — every `insert-device` this file builds carries a
// projected device, not the raw project one.
import { projectDeviceForNativeBody } from './projectDeviceForNativeBody';
import { projectsToDifferentNativeBank } from './projectsToDifferentNativeBank';
import { readNativeChain } from './readNativeChain';
import { rearmNativeLiveAutomationWriterInPlace } from './rearmNativeLiveAutomationWriterInPlace';
import { rearmNativeLiveMidiWriterInPlace } from './rearmNativeLiveMidiWriterInPlace';
import { recordNativeChains } from './recordNativeChains';
import { reportAttachedPlugins } from './reportAttachedPlugins';

export type MirrorDeviceChainDeltaInput = Readonly<{
    /** The track's chain as it was before the change the caller just committed. */
    before: Track;
    /** The chain the caller compiled its Web Audio delta from. */
    after: Track;
}>;

export type MirrorDeviceChainDeltaResult =
    | Readonly<{ outcome: 'skipped'; reason: string }>
    | Readonly<{ outcome: 'mirrored' }>
    | Readonly<{ outcome: 'declined'; reason: string }>;

/** The batch to send, and the devices a decline would be about. */
type MirrorPlan = Readonly<{
    commands: readonly AudioGraphCommand[];
    changedDeviceNames: readonly string[];
}>;

function idsOf(devices: readonly Device[]): readonly string[] {
    return devices.map((device) => device.id);
}

/**
 * Whether the devices this change keeps come out in a different order than they
 * went in.
 *
 * The one shape an insert-and-remove diff cannot express: moving a device needs
 * the whole chain rebuilt, because `insert-device` places a device the engine
 * does not hold and there is no command that moves one it does.
 */
function survivorsWereReordered(before: readonly Device[], after: readonly Device[]): boolean {
    const afterIds = new Set(idsOf(after));
    const beforeIds = new Set(idsOf(before));
    const keptBefore = idsOf(before).filter((id) => afterIds.has(id));
    const keptAfter = idsOf(after).filter((id) => beforeIds.has(id));
    return keptBefore.length !== keptAfter.length || keptBefore.some((id, index) => id !== keptAfter[index]);
}

/**
 * The remembered pedals for every device this rebuild is about to build again
 * on this track ({@link latchedPedalCommands}).
 */
function latchedPedalsFor(track: Track): readonly AudioGraphCommand[] {
    return latchedPedalCommands(track.devices.map((device) => ({ trackId: track.id, deviceId: device.id })));
}

/**
 * The `after` devices this edit rebuilds because their projected sample bank
 * key changed, even though the device itself neither joined nor left the
 * chain — the one change an insert-and-remove-by-id diff cannot see on its
 * own (see this file's header).
 */
function swappedDevices(before: readonly Device[], after: readonly Device[]): readonly Device[] {
    const beforeById = new Map(before.map((device) => [device.id, device]));
    return after.filter((device) => {
        const priorDevice = beforeById.get(device.id);
        return priorDevice !== undefined && projectsToDifferentNativeBank(priorDevice, device);
    });
}

/**
 * Take the whole chain down and build it back in project order, in one batch.
 *
 * The batch applies at a single block boundary, so the strip is never observed
 * holding half of each chain; the brief interruption on that one strip is the
 * accepted cost of reordering a chain mid-take. An engine-owned device survives
 * it — the instance is released from the chain rather than retired — while a
 * built-in is rebuilt from the parameters the `Device` payload carries.
 *
 * Indices are project positions here, and that is correct: the mapper clamps an
 * index to the chain it has, so devices it omits leave the ones behind them
 * clamped to the end, in order.
 *
 * The remembered pedals ride this same batch, behind every insert, for the
 * reasons {@link latchedPedalCommands} states — a rebuilt body would otherwise
 * render with the player's foot lifted.
 */
function rebuildChain(track: Track, nativeChain: readonly string[]): readonly AudioGraphCommand[] {
    return [
        ...nativeChain.map((deviceId): AudioGraphCommand => ({ kind: 'remove-device', trackId: track.id, deviceId })),
        ...track.devices.map((device, index): AudioGraphCommand => ({
            kind: 'insert-device',
            trackId: track.id,
            device: projectDeviceForNativeBody(device),
            index,
        })),
        ...latchedPedalsFor(track),
    ];
}

function editChain(
    input: MirrorDeviceChainDeltaInput,
    nativeChain: readonly string[],
    swapped: readonly Device[]
): readonly AudioGraphCommand[] {
    const { before, after } = input;
    const afterIds = new Set(idsOf(after.devices));
    const beforeIds = new Set(idsOf(before.devices));
    const swappedIds = new Set(idsOf(swapped));
    const removed = idsOf(before.devices).filter((id) => !afterIds.has(id) && nativeChain.includes(id));
    const commands: AudioGraphCommand[] = removed.map((deviceId) => ({
        kind: 'remove-device',
        trackId: after.id,
        deviceId,
    }));
    // The chain as the engine will hold it once the removals above land, and it
    // is what the indices below are counted against — an insert placed against
    // the pre-removal chain would sit one slot too far along.
    let projected = nativeChain.filter((id) => !removed.includes(id));
    for (const device of after.devices) {
        const isNew = !beforeIds.has(device.id);
        // Held natively and its bank key changed: the instance the engine
        // built for it names the old bank and has no door to change which one
        // that is, so this device is torn down and built again — at the same
        // position, immediately, rather than left to the next play.
        const isSwapped = !isNew && swappedIds.has(device.id) && projected.includes(device.id);
        const unchanged = !isNew && !isSwapped;
        if (unchanged) {
            continue;
        }
        if (isSwapped) {
            commands.push({ kind: 'remove-device', trackId: after.id, deviceId: device.id });
            projected = projected.filter((id) => id !== device.id);
        }
        const index = nativeInsertIndex(idsOf(after.devices), device.id, projected);
        commands.push({ kind: 'insert-device', trackId: after.id, device: projectDeviceForNativeBody(device), index });
        // Behind the insert that builds it, for the reason a rebuild carries
        // them behind its own: the body this edit builds comes up with its
        // pedals raised, and an edit builds one under an id the latch already
        // knows whenever an undo restores a removed device.
        commands.push(...latchedPedalCommands([{ trackId: after.id, deviceId: device.id }]));
        projected = [...projected.slice(0, index), device.id, ...projected.slice(index)];
    }
    return commands;
}

/** Whether the automation pass in flight writes any parameter of this device. */
function passWritesDevice(trackId: string, deviceId: string): boolean {
    return (nativeLiveAutomationWriter.pass?.targets ?? []).some(
        ({ target }) => target.kind === 'device-parameter' && target.trackId === trackId && target.deviceId === deviceId
    );
}

/**
 * Whether this batch changes what the passes in flight can carry.
 *
 * Two shapes of command do, and the rule names exactly those two because
 * re-arming costs a whole lookahead of admitted stamps.
 *
 * An insert, only of a hosted plugin or of a built-in with a native body: the
 * engine stamps a hosted plugin's parameters and a native-bodied built-in's
 * parameters, and nothing else's — so the automation pass was projected
 * without parameters it can now carry. And a native body that takes notes
 * gives the strip its sink the moment it joins the chain, so the note pass was
 * projected against a strip that had none. An insert of a device with no
 * native body still leaves both passes describing exactly the same work.
 *
 * A removal, only of a device the pass still targets: the next pump would name
 * a device the graph no longer has, which `graph.rs` refuses whole as `unknown
 * device` — and testing the pass rather than the device's kind is both the
 * narrower rule and the exact one, because the pass's own targets are the only
 * devices a pump can name.
 *
 * A replayed pedal is neither shape, and needs no third arm: it names a device
 * an `insert-device` in the same batch has just put back, and that insert is
 * what the rule already answers for.
 */
function changesWhatThePassCarries(commands: readonly AudioGraphCommand[]): boolean {
    return commands.some(
        (command) =>
            (command.kind === 'insert-device' &&
                (isHostedPluginDevice(command.device) || nativeBuiltinBody(command.device.type) !== null)) ||
            (command.kind === 'remove-device' && passWritesDevice(command.trackId, command.deviceId))
    );
}

function changedDeviceNames(input: MirrorDeviceChainDeltaInput, swapped: readonly Device[]): readonly string[] {
    const { before, after } = input;
    const afterIds = new Set(idsOf(after.devices));
    const beforeIds = new Set(idsOf(before.devices));
    return [
        ...before.devices.filter((device) => !afterIds.has(device.id)),
        ...after.devices.filter((device) => !beforeIds.has(device.id)),
        ...swapped,
    ].map((device) => device.name);
}

function planMirror(input: MirrorDeviceChainDeltaInput, nativeChain: readonly string[]): MirrorPlan {
    const reordered = survivorsWereReordered(input.before.devices, input.after.devices);
    // Computed once and shared: the edit path and the decline notice both ask
    // which survivors changed instrument, and asking twice would cost a
    // second `projectDeviceForNativeBody` pass over every survivor for no
    // reason — the answer cannot differ between the two callers.
    const swapped = swappedDevices(input.before.devices, input.after.devices);
    return {
        commands: reordered ? rebuildChain(input.after, nativeChain) : editChain(input, nativeChain, swapped),
        // Empty for a pure reorder, which is what makes the notice name the
        // chain rather than a device that did not change.
        changedDeviceNames: changedDeviceNames(input, swapped),
    };
}

export function mirrorDeviceChainDelta(input: MirrorDeviceChainDeltaInput): Promise<MirrorDeviceChainDeltaResult> {
    return queueOnNativeLiveGraphSession(async (): Promise<MirrorDeviceChainDeltaResult> => {
        const backend = nativeLiveGraphSession.backend;
        if (!backend) {
            return { outcome: 'skipped', reason: 'no session' };
        }
        if (!nativeLiveGraphSession.rolling) {
            // The next play sends the whole topology, built from project truth
            // as it stands then, so a parked session owes this change nothing.
            return { outcome: 'skipped', reason: 'parked' };
        }
        const nativeChain = readNativeChain(input.after.id);
        if (!nativeChain) {
            // A track added since this session's topology went out. It has no
            // strip to edit, and no command here creates one.
            return { outcome: 'skipped', reason: 'strip not built' };
        }
        const plan = planMirror(input, nativeChain);
        if (plan.commands.length === 0) {
            return { outcome: 'skipped', reason: 'nothing to mirror' };
        }
        const result = await backend.apply({ schemaVersion: 1, commands: plan.commands });
        reportAttachedPlugins(result);
        if (result.application !== 'applied') {
            // The record is left exactly as it was, and it is still true: the
            // batch is whole-or-nothing, so a refused one moved no chain.
            notifyDeferredChainChange({
                trackName: input.after.name,
                deviceNames: plan.changedDeviceNames,
                reason: result.reason,
            });
            return { outcome: 'declined', reason: result.reason };
        }
        recordNativeChains(result.reports);
        if (changesWhatThePassCarries(plan.commands)) {
            // The pass in flight was projected against the chain this batch has
            // just changed — missing a plugin's parameters, or still naming a
            // device the engine no longer holds. Re-reading from where the
            // engine stands is what puts it back in step.
            rearmNativeLiveAutomationWriterInPlace({
                provenAfterBatch: result.admittedBatch ?? null,
                positionSeconds: nativeEnginePlayheadFeed.reading?.positionSeconds,
            });
            // The removal arm above fires only for a device the automation
            // pass still writes, but the note pass is re-read alongside it
            // regardless: the same batch may have moved a strip's sink to an
            // instrument inserted ahead of the one that used to carry it, and
            // the note re-arm is what clears the store the demoted device
            // would otherwise keep replaying from.
            await rearmNativeLiveMidiWriterInPlace({
                positionSeconds: nativeEnginePlayheadFeed.reading?.positionSeconds,
            });
        }
        return { outcome: 'mirrored' };
    });
}
