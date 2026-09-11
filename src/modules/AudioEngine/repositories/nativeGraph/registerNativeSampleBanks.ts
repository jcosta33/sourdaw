/**
 * The native sample bank store, stocked for the batch about to be applied
 * (#3124).
 *
 * A Levain device is not built from its record: `map_device` looks the device's
 * `sampleBankKey` up in the bank store and refuses the device by name when no
 * committed bank stands there. So a batch carrying such a device owes its
 * material to the store *first*, exactly as a `schedule-clip` owes its PCM to
 * the timeline pool (`nativeTimelineSamplePool.ts`), and for the same reason:
 * the alternative to ordering is a strip that silently maps without its
 * instrument.
 *
 * Registration never throws. A bank that cannot be decoded or staged leaves its
 * key unregistered and the batch goes out regardless — the mapper then refuses
 * that one device, which is a strip a musician can see did not load, rather
 * than a play gesture that refused the whole project.
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
import { registeredNativeSampleBankKeys } from './registeredNativeSampleBankKeys';

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
        try {
            await registerBank(transport, bankKey, acquire);
        } catch {
            // Decode or transport failure. The key stays unregistered; the
            // engine refuses this one device and the next batch tries again.
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
