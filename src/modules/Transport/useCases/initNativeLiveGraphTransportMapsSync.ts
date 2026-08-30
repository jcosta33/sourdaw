/**
 * Push durable tempo, meter, and loop maps to a live native session when the
 * stores that own them change during playback (#3109).
 *
 * Loop gestures used to call `sendLoopRegionToNativeSession` themselves after
 * each commit. That missed every other writer — `addTempoChange` never touches
 * `transportStore`, and a CRDT `fromCrdt` hydrate writes the stores without
 * going through a gesture. Subscribing at the store boundary is the single
 * trigger: any maps-relevant `set` while playing or while a native session is
 * held re-projects and sends.
 *
 * The gate is `isPlaying || session held`, not session held alone. Play sets
 * `isPlaying` before the start await assigns the backend, so a maps write in
 * that window must still queue behind start — otherwise `previous` advances on
 * a drop and start installs the stale snapshot. A fromCrdt hydrate can clear
 * `isPlaying` while the backend stays open; session-held covers that case.
 * Backend assignment is not required to queue: the maps write declines if its
 * worker still sees no backend.
 *
 * Tempo and meter changes move the beat↔seconds integral under a fixed
 * playhead beat. After the maps write, a locate keeps the rolling engine on
 * the UI beat (`repositionNativeLiveGraphSession` declines when parked).
 * Loop-only edits leave that integral alone, so they send maps and stop.
 *
 * The snapshot captured at init is the baseline so the first subscribe
 * notification is a real change, not a restatement of what play already
 * installed. Playhead, metronome, and other non-maps fields are ignored.
 */

import { logger } from '#/infra/logger/appLogger';
import { isNativeLiveGraphSessionHeld, repositionNativeLiveGraphSession } from '#/modules/AudioEngine/useCases';

import { playheadPositionRef } from '../stores/playheadPositionRef';
import { tempoMapStore, type TempoMapStoreState } from '../stores/tempoMapStore';
import { timeSignatureMapStore, type TimeSignatureMapStoreState } from '../stores/timeSignatureMapStore';
import { transportStore } from '../stores/transportStore';

import { secondsBetweenBeats } from './secondsBetweenBeats';
import { sendLoopRegionToNativeSession } from './transportControls/sendLoopRegionToNativeSession';

type MapsRelevantSnapshot = {
    tempo: number | null;
    timeSignatureNumerator: number | null;
    timeSignatureDenominator: number | null;
    isLooping: boolean | null;
    loopStart: number | null;
    loopEnd: number | null;
    tempoMap: TempoMapStoreState | null;
    timeSignatureMap: TimeSignatureMapStoreState | null;
};

function captureMapsRelevantSnapshot(): MapsRelevantSnapshot {
    const transport = transportStore.value;
    return {
        tempo: transport?.tempo ?? null,
        timeSignatureNumerator: transport?.timeSignatureNumerator ?? null,
        timeSignatureDenominator: transport?.timeSignatureDenominator ?? null,
        isLooping: transport?.isLooping ?? null,
        loopStart: transport?.loopStart ?? null,
        loopEnd: transport?.loopEnd ?? null,
        tempoMap: tempoMapStore.value,
        timeSignatureMap: timeSignatureMapStore.value,
    };
}

function mapsRelevantFieldsChanged(previous: MapsRelevantSnapshot, next: MapsRelevantSnapshot): boolean {
    return (
        previous.tempo !== next.tempo ||
        previous.timeSignatureNumerator !== next.timeSignatureNumerator ||
        previous.timeSignatureDenominator !== next.timeSignatureDenominator ||
        previous.isLooping !== next.isLooping ||
        previous.loopStart !== next.loopStart ||
        previous.loopEnd !== next.loopEnd ||
        previous.tempoMap !== next.tempoMap ||
        previous.timeSignatureMap !== next.timeSignatureMap
    );
}

function tempoOrMeterMapsChanged(previous: MapsRelevantSnapshot, next: MapsRelevantSnapshot): boolean {
    return (
        previous.tempo !== next.tempo ||
        previous.timeSignatureNumerator !== next.timeSignatureNumerator ||
        previous.timeSignatureDenominator !== next.timeSignatureDenominator ||
        previous.tempoMap !== next.tempoMap ||
        previous.timeSignatureMap !== next.timeSignatureMap
    );
}

function locateNativeSessionToCurrentBeat(): void {
    const tempo = transportStore.value?.tempo;
    if (tempo === undefined) {
        return;
    }

    Promise.resolve(
        repositionNativeLiveGraphSession({
            positionSeconds: secondsBetweenBeats(
                tempoMapStore.value?.changes ?? [],
                0,
                playheadPositionRef.current,
                tempo
            ),
        })
    ).catch((error: unknown) => {
        logger.warn(new Error('Native live graph session failed to relocate after transport maps', { cause: error }));
    });
}

export function initNativeLiveGraphTransportMapsSync(): () => void {
    let previous = captureMapsRelevantSnapshot();

    const onStoreWrite = (): void => {
        const next = captureMapsRelevantSnapshot();
        const changed = mapsRelevantFieldsChanged(previous, next);
        const locateAfterMaps = tempoOrMeterMapsChanged(previous, next);
        previous = next;

        if (!changed) {
            return;
        }

        const isPlaying = transportStore.value?.isPlaying === true;
        if (!isPlaying && !isNativeLiveGraphSessionHeld()) {
            return;
        }

        sendLoopRegionToNativeSession();

        if (locateAfterMaps) {
            locateNativeSessionToCurrentBeat();
        }
    };

    const unsubscribeTransport = transportStore.subscribe(onStoreWrite);
    const unsubscribeTempoMap = tempoMapStore.subscribe(onStoreWrite);
    const unsubscribeTimeSignatureMap = timeSignatureMapStore.subscribe(onStoreWrite);

    return () => {
        unsubscribeTransport();
        unsubscribeTempoMap();
        unsubscribeTimeSignatureMap();
    };
}
