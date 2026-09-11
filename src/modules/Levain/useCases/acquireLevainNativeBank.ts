import { levainInstrumentIdFromNativeBankKey } from '../models/LevainNativeBankKey';
import { decodedBankResource } from '../repositories/sampleLoader/decodedBankResource';
import { WEB_LOD } from '../repositories/sampleLoader/helpers';
import { resolveSampleBasePath } from '../repositories/sampleLoader/resolveSampleBasePath';

import { decodedBankToNativeSampleBank } from './decodedBankToNativeSampleBank';

/**
 * Decode the instrument a native bank key names and hand the native side's
 * view of it over, with the lease that keeps the material alive (#3124).
 *
 * The manifest URL, base path and LOD are resolved exactly as
 * `autoLoadLevainSamples` resolves them for the worklet, through the same
 * reference-counted `decodedBankResource`: a strip that is carried natively and
 * one that is carried on Web Audio then share one decode rather than paying for
 * the instrument twice, and the desktop shell's bundled sample library is
 * reached the same way on both paths.
 *
 * `null` for a key this module does not own, or whose instrument this build
 * does not know. A decode that *fails* throws instead — the caller leaves the
 * key unregistered so the next batch retries it, and `map_device` meanwhile
 * answers `Err` for the device by name rather than splicing a mute sampler.
 * On a strip that contributes audio that `Err` refuses the batch whole, so the
 * musician's play gesture declines native carriage with this bank in its reason
 * and the project plays on the Web Audio carrier; only a device on a strip that
 * contributes no audio is dropped by itself.
 *
 * The lease is released by the caller once the bytes have crossed the bridge;
 * the bank's life on the native side is ended by `release_levain_bank`, which
 * is `registerNativeSampleBanks`' own decision.
 */
export async function acquireLevainNativeBank(bankKey: string) {
    const instrumentId = levainInstrumentIdFromNativeBankKey(bankKey);
    if (!instrumentId) {
        return null;
    }

    const basePath = await resolveSampleBasePath(instrumentId);
    const lease = await decodedBankResource.acquire({
        manifestUrl: `${basePath}/manifest.json`,
        basePath,
        expectedInstrumentId: instrumentId,
        lod: WEB_LOD,
    });

    try {
        return { bank: decodedBankToNativeSampleBank(lease.bank), release: lease.release };
    } catch (error) {
        // The translation throws on a bank the wire cannot carry — a missing
        // file, a channel count the store refuses. Release before rethrowing:
        // nothing else holds this lease.
        lease.release();
        throw error;
    }
}
