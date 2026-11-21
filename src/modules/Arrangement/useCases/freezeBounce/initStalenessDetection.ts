import { automationStore } from '#/modules/Automation/stores';
import { sidechainStore } from '#/modules/Routing/stores';
import { FREEZE_BAKE_VERSION } from '#/utils/frozenBufferTail';

import { updateTrack } from '../../repositories/track/updateTrack';
import { trackStore, type TrackStoreState } from '../../stores/trackStore';
import { vcaGroupStore } from '../../stores/vcaGroupStore';

import { computeFreezeSourceHash } from './computeFreezeSourceHash';
import { type FreezeSources } from './freezeSourceTracks';
import { takeChangedFreezeSources } from './takeChangedFreezeSources';

let isEvaluating = false;
let prevState: TrackStoreState | null = null;
const seenSources = new Map<string, FreezeSources>();

/**
 * Subscribes to the stores a freeze's render reads (tracks, sidechain routes, automation lanes,
 * VCA groups) to detect when a frozen track's sources are modified, transitioning its state to
 * 'stale'. A write only costs a hash when the sources of some frozen track actually differ from
 * the ones last seen.
 *
 * Conforms to R8: Staleness Detection.
 */
export function initStalenessDetection(): () => void {
    prevState = trackStore.value; // capture initial state
    seenSources.clear();
    for (const track of prevState?.tracks ?? []) {
        if (track.freezeState.status === 'frozen') {
            takeChangedFreezeSources(seenSources, track.id);
        }
    }

    function evaluate(state: TrackStoreState | null): void {
        void (async () => {
            if (isEvaluating || !state || !prevState) {
                prevState = state;
                return;
            }

            isEvaluating = true;
            const previous = prevState;
            prevState = state;

            try {
                for (const track of state.tracks) {
                    if (track.freezeState.status !== 'frozen') {
                        seenSources.delete(track.id);
                        continue;
                    }

                    // A buffer baked under older freeze rules is wrong in ways
                    // no downstream fix reaches: it was cut short by a tail the
                    // device declarations never sized, and it has this track's
                    // fader and pan position printed into it, which playback
                    // then applies a second time. Re-rendering is the only
                    // remedy, so it is marked stale — the state the UI already
                    // offers a re-freeze from — regardless of whether its
                    // content changed.
                    //
                    // Deliberately checked before the predecessor lookup, since
                    // it reads nothing from the predecessor. Below that guard it
                    // never fired on the load projection, where every track is
                    // new and therefore skipped — so a user who opened a project
                    // and pressed play straight away heard the legacy buffer
                    // with fader and pan applied twice, until some later
                    // unrelated store update happened to mark it.
                    if ((track.freezeState.renderSettings?.bakeVersion ?? 0) < FREEZE_BAKE_VERSION) {
                        updateTrack(track.id, (time) => ({
                            ...time,
                            freezeState: { ...time.freezeState, status: 'stale' },
                        }));
                        continue;
                    }

                    const prevTrack = previous.tracks.find((time) => time.id === track.id);
                    // Read for every frozen track, so the first sighting is recorded even when
                    // the predecessor lookup below skips it.
                    //
                    // The signature covers every track the freeze's render reads, so an edit to a
                    // routed source, or a routing change that adds or removes one, counts.
                    const sources = takeChangedFreezeSources(seenSources, track.id);
                    if (prevTrack && sources) {
                        const hash = await computeFreezeSourceHash(sources);
                        if (hash !== track.freezeState.sourceContentHash) {
                            updateTrack(track.id, (time) => ({
                                ...time,
                                freezeState: { ...time.freezeState, status: 'stale' },
                            }));
                        }
                    }
                }
            } finally {
                isEvaluating = false;
            }
        })();
    }

    const unsubscribes = [
        trackStore.subscribe(evaluate),
        sidechainStore.subscribe(() => {
            evaluate(trackStore.value);
        }),
        automationStore.subscribe(() => {
            evaluate(trackStore.value);
        }),
        vcaGroupStore.subscribe(() => {
            evaluate(trackStore.value);
        }),
    ];

    return () => {
        for (const unsubscribe of unsubscribes) {
            unsubscribe();
        }
    };
}
