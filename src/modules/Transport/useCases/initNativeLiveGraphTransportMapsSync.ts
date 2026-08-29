/**
 * Push durable tempo, meter, and loop maps to a live native session when the
 * stores that own them change during playback (#3109).
 *
 * Loop gestures used to call `sendLoopRegionToNativeSession` themselves after
 * each commit. That missed every other writer — `addTempoChange` never touches
 * `transportStore`, and a CRDT `fromCrdt` hydrate writes the stores without
 * going through a gesture. Subscribing at the store boundary is the single
 * trigger: any maps-relevant `set` while a native session is held re-projects and sends.
 *
 * The snapshot captured at init is the baseline so the first subscribe
 * notification is a real change, not a restatement of what play already
 * installed. Playhead, metronome, and other non-maps fields are ignored.
 */

import { isNativeLiveGraphSessionHeld } from '#/modules/AudioEngine/useCases';

import { tempoMapStore, type TempoMapStoreState } from '../stores/tempoMapStore';
import { timeSignatureMapStore, type TimeSignatureMapStoreState } from '../stores/timeSignatureMapStore';
import { transportStore } from '../stores/transportStore';

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

export function initNativeLiveGraphTransportMapsSync(): () => void {
    let previous = captureMapsRelevantSnapshot();

    const onStoreWrite = (): void => {
        const next = captureMapsRelevantSnapshot();
        const changed = mapsRelevantFieldsChanged(previous, next);
        previous = next;

        if (!changed) {
            return;
        }
        if (!isNativeLiveGraphSessionHeld()) {
            return;
        }

        sendLoopRegionToNativeSession();
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
