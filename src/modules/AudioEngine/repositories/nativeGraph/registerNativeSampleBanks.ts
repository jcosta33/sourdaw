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
 * more *for that backend* and `release_levain_bank` reclaims its PCM and every
 * rate conversion of it — but only once no other backend still claims it. The
 * live backend and an offline bounce both stage into this one process-wide
 * store, so a live replacement's whole graph says nothing about a bank a
 * concurrent bounce is still mapping; `claimedNativeSampleBankKeysByBackend`
 * is what keeps a release scoped to keys no backend speaks for, rather than to
 * keys the one backend replacing its topology happens to name. An incremental
 * batch states only a change: a key missing from it says nothing about the
 * strips the batch did not mention, so nothing is released.
 */

import { type AudioGraphCommand } from '../../models/AudioGraphBackend';
import { type NativeSampleBankLease } from '../../models/NativeSampleBank';

import { collectNativeSampleBankKeys } from './collectNativeSampleBankKeys';
import { type NativeGraphTransport } from './nativeGraphTransport';
import {
    claimedNativeSampleBankKeysByBackend,
    inFlightNativeSampleBankShipments,
    registeredNativeSampleBankKeys,
} from './registeredNativeSampleBankKeys';

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
    /**
     * Which backend this batch belongs to, so its claim on the process-wide
     * store — {@link claimedNativeSampleBankKeysByBackend} — can be told apart
     * from every other backend's. A bounce staging `levain:trumpet` and a live
     * session replacing its topology without naming it are two different
     * callers of this one store, and only the bounce's own claim says the key
     * is still spoken for.
     */
    backendId: string;
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

/** Whether any backend's current claim still names this key. */
function isClaimedByAnyBackend(bankKey: string): boolean {
    for (const claim of claimedNativeSampleBankKeysByBackend.values()) {
        if (claim.has(bankKey)) {
            return true;
        }
    }
    return false;
}

async function releaseUnnamedBanks(transport: NativeGraphTransport): Promise<void> {
    for (const bankKey of [...registeredNativeSampleBankKeys]) {
        if (isClaimedByAnyBackend(bankKey) || inFlightNativeSampleBankShipments.has(bankKey)) {
            continue;
        }
        // Dropped before the await, not after: a registration for this key
        // that begins while the release is in flight must see it unregistered
        // and re-stage, rather than believe a bank the store is about to drop
        // is still committed.
        registeredNativeSampleBankKeys.delete(bankKey);
        try {
            await transport.releaseLevainBank({ bankKey });
        } catch {
            // The store may still hold the bank, but the key stays
            // unregistered either way: the next batch that names it re-stages
            // (the store holds the bank meanwhile), which costs a redundant
            // stage, never correctness — believing a release that did not
            // land would risk mapping a device against a bank the store went
            // on to drop regardless.
            continue;
        }
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
    const { transport, commands, acquire, replaceTopology, backendId } = input;
    const named = collectNativeSampleBankKeys(commands);
    const committed: string[] = [];

    // Replace rather than union: a `replaceTopology` batch states this
    // backend's *whole* graph, so a key it no longer names must stop being
    // this backend's claim, not merely gain company in it — otherwise a
    // device a musician removed from a live session would keep its bank alive
    // through every later replacement that also forgot to drop it.
    //
    // Recorded before the staging loop below, not after: a batch naming
    // several keys stages them one at a time, and a key already shipped —
    // committed to the process-wide store — must never sit unclaimed by this
    // backend while a sibling key in the same batch is still in flight. A
    // release racing in during that window reads every backend's claim
    // (`isClaimedByAnyBackend`), and a claim recorded only after the whole
    // batch finishes would leave an already-committed key looking owned by no
    // one for as long as the batch takes to stage the rest.
    const previousClaim = claimedNativeSampleBankKeysByBackend.get(backendId) ?? new Set<string>();
    const nextClaim = replaceTopology === true ? new Set(named) : new Set([...previousClaim, ...named]);
    claimedNativeSampleBankKeysByBackend.set(backendId, nextClaim);

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
        await releaseUnnamedBanks(transport);
    }

    return committed;
}
