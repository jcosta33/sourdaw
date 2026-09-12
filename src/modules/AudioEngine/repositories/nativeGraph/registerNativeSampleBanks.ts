/**
 * The native sample bank store, stocked for the batch about to be applied
 * (#3124).
 *
 * A Levain device is not built from its record: `map_device` looks the device's
 * `sampleBankKey` up in the bank store and answers `Err` for the device by name
 * when no committed bank stands there. So a batch carrying such a device owes
 * its material to the store *first*, exactly as a `schedule-clip` owes its PCM
 * to the timeline pool (`nativeTimelineSamplePool.ts`), and for the same
 * reason: the alternative to ordering is a strip that silently maps without its
 * instrument.
 *
 * Registration never throws, but a key it fails to stage is not a small loss.
 * The batch goes out regardless and `refuse_or_degrade` decides what that `Err`
 * costs: on a strip that contributes audio it refuses the batch whole, so the
 * play gesture declines native carriage with the bank named in its reason and
 * the project plays on the Web Audio carrier instead
 * (`startNativeLiveGraphSession`). Only a device on a strip that contributes no
 * audio — muted, or routed nowhere the mix reads — is dropped on its own.
 * Throwing here would buy nothing over that: the same gesture declines either
 * way, and the batch's other strips would lose their one chance to be heard
 * natively.
 *
 * Only a topology replacement releases. A `replaceTopology` batch states the
 * whole graph, so a key it does not name is an instrument nothing plays any
 * more and `release_levain_bank` reclaims its PCM and every rate conversion of
 * it. An incremental batch states only a change: a key missing from it says
 * nothing about the strips the batch did not mention, so nothing is released.
 */

import { type AudioGraphCommand } from '../../models/AudioGraphBackend';
import { type NativeSampleBankLease } from '../../models/NativeSampleBank';

import { collectNativeSampleBankKeys } from './collectNativeSampleBankKeys';
import { type NativeGraphTransport } from './nativeGraphTransport';
import { inFlightNativeSampleBankShipments, registeredNativeSampleBankKeys } from './registeredNativeSampleBankKeys';

/** Leases the bank one key names, or `null` for a key no module owns. */
export type AcquireNativeSampleBank = (bankKey: string) => Promise<NativeSampleBankLease | null>;

export type RegisterNativeSampleBanksInput = Readonly<{
    transport: NativeGraphTransport;
    /**
     * The batch whose devices must find their banks. Read for the three
     * commands that carry a device, so what is staged is exactly what the batch
     * maps — never a second rule about which instruments a session needs.
     */
    commands: readonly AudioGraphCommand[];
    acquire: AcquireNativeSampleBank;
    /** The batch's own `replaceTopology`, which is what licenses a release. */
    replaceTopology?: boolean;
}>;

/**
 * Stage one bank through `begin` → `register` × N → `commit`.
 *
 * The samples go one at a time rather than concurrently: each carries its whole
 * decoded file across the bridge, and an orchestral bank is hundreds of them —
 * sending them in parallel would hold every file's bytes in flight at once.
 */
async function stageBank(
    transport: NativeGraphTransport,
    bankKey: string,
    lease: NativeSampleBankLease
): Promise<void> {
    const { bank } = lease;
    await transport.beginLevainBank({ bankKey, instrumentId: bank.instrumentId });
    for (const sample of bank.samples) {
        await transport.registerLevainSample({
            bankKey,
            sampleId: sample.sampleId,
            sampleRate: sample.sampleRate,
            channels: sample.channels,
            pcm: sample.pcm,
        });
    }
    await transport.commitLevainBank({
        bankKey,
        layout: {
            // Narrowed deliberately: `LevainBankLayout` is deserialized with
            // `deny_unknown_fields`, so `instrumentId` or `samples` travelling
            // beside the zone map would refuse the whole commit.
            numArticulations: bank.numArticulations,
            numMics: bank.numMics,
            zones: bank.zones,
            legatoTransitions: bank.legatoTransitions,
        },
    });
}

async function registerBank(
    transport: NativeGraphTransport,
    bankKey: string,
    acquire: AcquireNativeSampleBank
): Promise<void> {
    const lease = await acquire(bankKey);
    if (!lease) {
        return;
    }
    try {
        await stageBank(transport, bankKey, lease);
        // Only a committed bank is believed: an interrupted stage leaves the
        // key unknown so the next batch stages it whole rather than committing
        // a half-filled one.
        registeredNativeSampleBankKeys.add(bankKey);
    } finally {
        // The decoded material is reference-counted and shared with the Web
        // Audio carrier. This lease exists only to keep it alive while the
        // bytes cross; the native side holds its own copy afterwards.
        lease.release();
    }
}

/**
 * Stage one key as *the* shipment for it, so a concurrent caller can wait
 * rather than start a second `begin` over this one's samples.
 *
 * The entry is published before the first await and withdrawn when the shipment
 * settles, whichever way it settled: a failed stage left the key uncommitted,
 * and the next batch is entitled to try it again.
 */
async function shipBank(
    transport: NativeGraphTransport,
    bankKey: string,
    acquire: AcquireNativeSampleBank
): Promise<void> {
    const shipment = registerBank(transport, bankKey, acquire).finally(() => {
        inFlightNativeSampleBankShipments.delete(bankKey);
    });
    inFlightNativeSampleBankShipments.set(bankKey, shipment);
    await shipment;
}

async function releaseUnnamedBanks(transport: NativeGraphTransport, named: readonly string[]): Promise<void> {
    for (const bankKey of [...registeredNativeSampleBankKeys]) {
        if (named.includes(bankKey)) {
            continue;
        }
        try {
            await transport.releaseLevainBank({ bankKey });
        } catch {
            // The store holds the bank either way; a release that did not land
            // costs memory, never correctness, and re-staging replaces it.
            continue;
        }
        registeredNativeSampleBankKeys.delete(bankKey);
    }
}

/**
 * Put every bank this batch's devices name into the native store, skipping what
 * is already there, and reclaim what a topology replacement dropped.
 *
 * Answers the keys this call actually committed, so a caller can tell staging
 * that did work from a call that found nothing to do.
 */
export async function registerNativeSampleBanks(input: RegisterNativeSampleBanksInput): Promise<readonly string[]> {
    const { transport, commands, acquire, replaceTopology } = input;
    const named = collectNativeSampleBankKeys(commands);
    const committed: string[] = [];

    for (const bankKey of named) {
        if (registeredNativeSampleBankKeys.has(bankKey)) {
            continue;
        }
        const inFlight = inFlightNativeSampleBankShipments.get(bankKey);
        if (inFlight !== undefined) {
            // Someone else's shipment owns this key. Wait for it — the batch
            // must not go out ahead of the commit it needs — and take no credit
            // for it: the key was staged by that call, not this one, so a
            // caller reading the answer learns what its own staging did.
            await inFlight.catch(() => undefined);
            continue;
        }
        try {
            await shipBank(transport, bankKey, acquire);
        } catch {
            // Decode or transport failure. The key stays unregistered, so
            // `map_device` answers `Err` for the devices naming it and the next
            // batch stages it again.
            continue;
        }
        if (registeredNativeSampleBankKeys.has(bankKey)) {
            committed.push(bankKey);
        }
    }

    if (replaceTopology === true) {
        await releaseUnnamedBanks(transport, named);
    }

    return committed;
}
