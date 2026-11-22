import { subgraphPrintInputsMatch, subscribeSubgraphPrintInputStores } from '#/modules/AudioEngine/useCases';
import { FREEZE_BAKE_VERSION } from '#/utils/frozenBufferTail';

import { updateTrack } from '../../repositories/track/updateTrack';
import { type Track, trackStore } from '../../stores/trackStore';

import { digestFreezePrintInput } from './digestFreezePrintInput';
import { readLiveFreezePrintInput } from './readLiveFreezePrintInput';
import { type FreezePrintInput } from './selectFreezePrintInput';

function markStale(trackId: string): void {
    updateTrack(trackId, (time) => ({
        ...time,
        freezeState: { ...time.freezeState, status: 'stale' },
    }));
}

/**
 * A buffer baked under older freeze rules is wrong in ways no downstream fix reaches: it was cut
 * short by a tail the device declarations never sized, and it has this track's fader and pan
 * position printed into it, which playback then applies a second time. Re-rendering is the only
 * remedy, so it is stale, the state the UI already offers a re-freeze from, whatever its sources.
 */
function bakedUnderOlderRules(track: Track): boolean {
    return (track.freezeState.renderSettings?.bakeVersion ?? 0) < FREEZE_BAKE_VERSION;
}

/**
 * Re-evaluates every frozen track whenever a store its render reads is written (the tracks, MIDI
 * rows, automation, sidechain routes, VCA groups, takes, clip gain envelopes, adjustment layers and
 * modulators), and marks a track stale once the input its freeze prints no longer has the
 * signature the take was rendered from.
 *
 * Change detection is by reference: a frozen track's print input is reselected on each write, and
 * only digested when it reads some value other than the ones last seen. A first sighting (a
 * freshly loaded or freshly frozen track) records what it reads and digests nothing, so a freeze
 * signed under older rules stays frozen until one of its sources changes.
 *
 * Evaluation is synchronous. A write it causes, or any write that lands while it runs, asks for one
 * more pass after it rather than being dropped.
 *
 * Conforms to R8: Staleness Detection.
 */
export function initStalenessDetection(): () => void {
    const seen = new Map<string, FreezePrintInput>();
    let active = true;
    let evaluating = false;
    let passRequested = false;

    function evaluateTrack(track: Track): void {
        if (bakedUnderOlderRules(track)) {
            markStale(track.id);
            return;
        }
        const input = readLiveFreezePrintInput(track.id);
        if (!input) {
            return;
        }
        const previous = seen.get(track.id);
        seen.set(track.id, input);
        if (previous === undefined || subgraphPrintInputsMatch(previous, input)) {
            return;
        }
        if (digestFreezePrintInput(input) !== track.freezeState.sourceContentHash) {
            markStale(track.id);
        }
    }

    function runPass(): void {
        const frozenTracks = (trackStore.value?.tracks ?? []).filter((track) => track.freezeState.status === 'frozen');
        const frozenIds = new Set(frozenTracks.map((track) => track.id));
        for (const trackId of seen.keys()) {
            if (!frozenIds.has(trackId)) {
                seen.delete(trackId);
            }
        }
        for (const track of frozenTracks) {
            evaluateTrack(track);
        }
    }

    function takePassRequest(): boolean {
        const requested = passRequested && active;
        passRequested = false;
        return requested;
    }

    function evaluate(): void {
        if (!active) {
            return;
        }
        if (evaluating) {
            passRequested = true;
            return;
        }
        evaluating = true;
        try {
            do {
                runPass();
            } while (takePassRequest());
        } finally {
            evaluating = false;
        }
    }

    for (const track of trackStore.value?.tracks ?? []) {
        if (track.freezeState.status !== 'frozen') {
            continue;
        }
        const input = readLiveFreezePrintInput(track.id);
        if (input) {
            seen.set(track.id, input);
        }
    }

    const unsubscribe = subscribeSubgraphPrintInputStores(evaluate);

    return () => {
        active = false;
        seen.clear();
        unsubscribe();
    };
}
