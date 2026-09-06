/**
 * Put a plugin the engine has just taken into the chain that names it, while
 * the session is rolling (#3575).
 *
 * An `external-plugin` device has a native body exactly when the engine reports
 * its instance attached, and the batch that attaches an instance is always
 * mapped before the engine holds it. Parked, that costs nothing: the next
 * play's topology batch is built against the attach state the report wrote and
 * binds the device by itself. Rolling, no such batch is coming — the topology
 * is not replaced mid-roll — so the strip keeps a chain with no body for that
 * device until the transport stops. One `insert-device` closes that window.
 *
 * Idempotent by construction rather than by a flag: the device is spliced only
 * when the engine's own chain does not already list it, so the mirror and this
 * splice can both fire for the same device and the second one finds nothing to
 * do. The mapper would otherwise refuse the batch for a device id already in a
 * chain.
 */

import { trackStore, type Device, type Track } from '#/modules/Arrangement/stores';

import { markAttachedInstances } from './markAttachedInstances';
import { nativeInsertIndex } from './nativeChainIndex';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { notifyDeferredChainChange } from './notifyDeferredChainChange';
import { readNativeChain } from './readNativeChain';
import { recordNativeChains } from './recordNativeChains';
import { requestNativeLiveAutomationWriterRearm } from './requestNativeLiveAutomationWriterRearm';
import { requestNativeLiveMidiWriterRearm } from './requestNativeLiveMidiWriterRearm';

export type NativeLiveGraphSessionSpliceInput = Readonly<{
    /** The external plugin instance the engine has taken. */
    instanceId: string;
}>;

export type NativeLiveGraphSessionSpliceResult =
    | Readonly<{ outcome: 'skipped'; reason: string }>
    | Readonly<{ outcome: 'spliced' }>
    | Readonly<{ outcome: 'declined'; reason: string }>;

type PlacedDevice = Readonly<{ track: Track; device: Device }>;

function findDeviceHolding(instanceId: string): PlacedDevice | undefined {
    for (const track of trackStore.value?.tracks ?? []) {
        const device = track.devices.find((candidate) => candidate.externalInstanceId === instanceId);
        if (device) {
            return { track, device };
        }
    }
    return undefined;
}

/**
 * Splice one attached instance into its strip's chain.
 *
 * Serialised on the session chain like every other session command, so it
 * cannot interleave with a topology batch or a mirror addressing the same
 * strip.
 */
export function nativeLiveGraphSessionSplice(
    input: NativeLiveGraphSessionSpliceInput
): Promise<NativeLiveGraphSessionSpliceResult> {
    return queueOnNativeLiveGraphSession(async (): Promise<NativeLiveGraphSessionSpliceResult> => {
        const backend = nativeLiveGraphSession.backend;
        if (!backend) {
            return { outcome: 'skipped', reason: 'no session' };
        }
        if (!nativeLiveGraphSession.rolling) {
            return { outcome: 'skipped', reason: 'parked' };
        }
        const placed = findDeviceHolding(input.instanceId);
        if (!placed) {
            return { outcome: 'skipped', reason: 'no device holds this instance' };
        }
        const nativeChain = readNativeChain(placed.track.id);
        if (!nativeChain) {
            return { outcome: 'skipped', reason: 'strip not built' };
        }
        if (nativeChain.includes(placed.device.id)) {
            return { outcome: 'skipped', reason: 'already spliced' };
        }
        const result = await backend.apply({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'insert-device',
                    trackId: placed.track.id,
                    device: placed.device,
                    index: nativeInsertIndex(
                        placed.track.devices.map((candidate) => candidate.id),
                        placed.device.id,
                        nativeChain
                    ),
                },
            ],
        });
        // Marked, never re-reported: a splice answering an attach that splices
        // again on its own answer has no bound, and the instances a splice
        // batch takes are covered by the next mirror or the next play.
        markAttachedInstances(result);
        if (result.application !== 'applied') {
            notifyDeferredChainChange({
                trackName: placed.track.name,
                deviceNames: [placed.device.name],
                reason: result.reason,
            });
            return { outcome: 'declined', reason: result.reason };
        }
        recordNativeChains(result.reports);
        // The plugin's parameters are the engine's to stamp from this batch on,
        // and the pass in flight was projected before the chain held it. The
        // re-read is requested rather than taken because this splice is reached
        // from the automation pump's own attach report; the next playhead
        // reading takes it, and the first pump after that carries the seeded
        // value at the position, which is what converges a plugin that attached
        // mid-roll.
        requestNativeLiveAutomationWriterRearm({ provenAfterBatch: result.admittedBatch ?? null });
        // The note pass owes the same re-read, and for the same reason: the
        // instance this splice put in the chain is the sink a MIDI strip's
        // notes are addressed to, and the pass in flight was projected before
        // the chain held it.
        requestNativeLiveMidiWriterRearm();
        return { outcome: 'spliced' };
    });
}
