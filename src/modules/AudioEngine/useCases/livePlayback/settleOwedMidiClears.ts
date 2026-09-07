/**
 * Send whatever `clear-midi` this side still owes the engine, ahead of
 * whatever else is arming (#3893).
 *
 * An owed clear names a store an outgoing pass held and no later pass
 * renewed, recorded rather than sent immediately because the pass that named
 * it is overwritten before its own opening batch is answered — there is
 * nowhere left to retry a refusal from once that happens. This module is the
 * retry: every arm calls it before its own opening batch, so an owed clear
 * gets another attempt on every re-arm until the engine takes one or the
 * chain record says the device is gone.
 *
 * Sent as its own batch, never folded into the opening batch it precedes: no
 * note is being moved into this store, so nothing this pass owns is released
 * early by splitting it out. A batch is refused whole, and an owed clear
 * refused for a device the engine has already released must not cost the
 * opening batch its own clears and notes alongside it.
 *
 * The round trip awaited here can suspend across another arm entirely — one
 * that re-adopts or re-abandons the very same target and reads or rewrites
 * `owedClears` while this call is still out. The caller's epoch says whether
 * this reply is still the one to trust: discharged only while it is still the
 * live epoch, and left standing otherwise, because deleting a key a later
 * arm's own settle is still tracking would discharge a debt this call was
 * never sent for.
 */

import { logger } from '#/infra/logger/appLogger';

import { type AudioGraphCommand } from '../../models/AudioGraphBackend';

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { nativeLiveMidiWriter } from './nativeLiveMidiWriterState';
import { readNativeChain } from './readNativeChain';
import { reportAttachedPlugins } from './reportAttachedPlugins';

export async function settleOwedMidiClears(epoch: number): Promise<void> {
    const owed = nativeLiveMidiWriter.owedClears;
    if (owed.size === 0) {
        return;
    }
    for (const [key, target] of owed) {
        // The record is written from the engine's own replies: its absence
        // says the engine released the device, and the store owed a clear
        // went with it.
        if (!readNativeChain(target.trackId)?.includes(target.deviceId)) {
            owed.delete(key);
        }
    }
    if (owed.size === 0) {
        return;
    }
    const backend = nativeLiveGraphSession.backend;
    if (!backend) {
        return;
    }
    const entries = [...owed.entries()];
    const commands: AudioGraphCommand[] = entries.map(([, target]) => ({
        kind: 'clear-midi',
        target,
        fromTime: 0,
        toTime: null,
    }));
    try {
        const result = await backend.apply({ schemaVersion: 1, commands });
        reportAttachedPlugins(result);
        if (result.application !== 'applied') {
            logger.warn(`[AudioEngine] owed live MIDI clears refused: ${result.reason}`);
            return;
        }
        // Discharge only under the epoch this send went out for. A newer arm
        // that ran its own settle while this one was in flight owns the map
        // now — its own reply is what should decide these keys, and a later
        // arm retries a key this reply leaves standing, so nothing is lost.
        if (nativeLiveMidiWriter.epoch !== epoch) {
            return;
        }
        for (const [key] of entries) {
            owed.delete(key);
        }
    } catch (error) {
        // A thrown apply is a bridge fault, not a decision about the clears:
        // they stay owed and the next arm retries them.
        logger.warn('[AudioEngine] owed live MIDI clears refused:', error);
    }
}
