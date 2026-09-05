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
import { nativeInsertIndex } from './nativeChainIndex';
import { nativeEnginePlayheadFeed } from './nativeEnginePlayheadFeedState';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { notifyDeferredChainChange } from './notifyDeferredChainChange';
import { readNativeChain } from './readNativeChain';
import { rearmNativeLiveAutomationWriterInPlace } from './rearmNativeLiveAutomationWriterInPlace';
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
 */
function rebuildChain(track: Track, nativeChain: readonly string[]): readonly AudioGraphCommand[] {
    return [
        ...nativeChain.map((deviceId): AudioGraphCommand => ({ kind: 'remove-device', trackId: track.id, deviceId })),
        ...track.devices.map((device, index): AudioGraphCommand => ({
            kind: 'insert-device',
            trackId: track.id,
            device,
            index,
        })),
    ];
}

function editChain(input: MirrorDeviceChainDeltaInput, nativeChain: readonly string[]): readonly AudioGraphCommand[] {
    const { before, after } = input;
    const afterIds = new Set(idsOf(after.devices));
    const beforeIds = new Set(idsOf(before.devices));
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
        if (beforeIds.has(device.id)) {
            continue;
        }
        const index = nativeInsertIndex(idsOf(after.devices), device.id, projected);
        commands.push({ kind: 'insert-device', trackId: after.id, device, index });
        projected = [...projected.slice(0, index), device.id, ...projected.slice(index)];
    }
    return commands;
}

/**
 * Whether this batch puts a hosted plugin into the engine's chain.
 *
 * Only such an insert changes what the automation producer can carry: the
 * engine stamps a hosted plugin's parameters and nothing else's, so a batch
 * that only removes devices or only inserts built-ins leaves the pass in flight
 * describing exactly the same set of writes, and re-arming for it would throw
 * away a whole lookahead of admitted stamps for nothing.
 */
function insertsHostedDevice(commands: readonly AudioGraphCommand[]): boolean {
    return commands.some((command) => command.kind === 'insert-device' && isHostedPluginDevice(command.device));
}

function changedDeviceNames(input: MirrorDeviceChainDeltaInput): readonly string[] {
    const { before, after } = input;
    const afterIds = new Set(idsOf(after.devices));
    const beforeIds = new Set(idsOf(before.devices));
    return [
        ...before.devices.filter((device) => !afterIds.has(device.id)),
        ...after.devices.filter((device) => !beforeIds.has(device.id)),
    ].map((device) => device.name);
}

function planMirror(input: MirrorDeviceChainDeltaInput, nativeChain: readonly string[]): MirrorPlan {
    const reordered = survivorsWereReordered(input.before.devices, input.after.devices);
    return {
        commands: reordered ? rebuildChain(input.after, nativeChain) : editChain(input, nativeChain),
        // Empty for a pure reorder, which is what makes the notice name the
        // chain rather than a device that did not change.
        changedDeviceNames: changedDeviceNames(input),
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
        if (insertsHostedDevice(plan.commands)) {
            // The pass in flight was projected before this plugin was in the
            // chain, so it describes no writes for its parameters. Re-reading
            // from where the engine stands is what carries them from here on.
            rearmNativeLiveAutomationWriterInPlace({
                provenAfterBatch: result.admittedBatch ?? null,
                positionSeconds: nativeEnginePlayheadFeed.reading?.positionSeconds,
            });
        }
        return { outcome: 'mirrored' };
    });
}
