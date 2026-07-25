import { type Track } from '../models/Track';
import { applySoloLogic, type SoloMode } from '../services/applySoloLogic';

export type { SoloMode };

/**
 * Effective-audibility read model (mute ∪ solo).
 *
 * OE-4 root cause: solo's audible consequence (muting the non-soloed tracks) was
 * applied only to the live engine nodes by `applySoloLogic`, and never projected
 * into the project-store state the offline exporter reads. A soloed mix therefore
 * exported every non-muted track — export diverged from what the engineer heard.
 *
 * This read model closes that store-vs-engine split WITHOUT duplicating the solo
 * math: it runs the one authoritative planner (`services/applySoloLogic`) and
 * projects its per-track `setMute` decisions into a `trackId → audible` map. The
 * live path keeps applying that planner's actions to the engine; the offline
 * mixdown consumes this projection to pick its source tracks. Both runtimes are
 * therefore driven by the same derivation — "export = what you hear".
 *
 * `audible` folds in both individual mute and solo-implied muting (mute ∪ solo),
 * honouring workspace solo mode (SIP / AFL / PFL), `soloSafe`, and solo-in-place
 * routing (soloing a bus keeps the tracks feeding it audible).
 */

export type EffectiveAudibilityInput = {
    tracks: readonly Track[];
    soloMode: SoloMode;
    /**
     * Ids of the tracks that own a rendered strip in the target runtime (live
     * strips online, offline strips during export). Solo state on tracks outside
     * this set does not engage, mirroring the live path.
     */
    stripTrackIds: ReadonlySet<string>;
};

export type EffectiveAudibility = {
    anySoloed: boolean;
    /** trackId → is the track's content audible in the resulting mix. */
    audibleByTrackId: ReadonlyMap<string, boolean>;
    /**
     * FX-8 — trackId → is the track silenced by solo-in-place rather than by its
     * own mute button. Audibility alone collapses the two, and export needs them
     * apart: a track the user muted still feeds its pre-fader (cue) sends, while
     * a solo-gated track must feed nothing at all.
     */
    soloGatedByTrackId: ReadonlyMap<string, boolean>;
};

export function hasActiveSolo({
    tracks,
    stripTrackIds,
}: {
    tracks: readonly Track[];
    stripTrackIds: ReadonlySet<string>;
}): boolean {
    return tracks.some((track) => track.kind !== 'master' && track.soloed && stripTrackIds.has(track.id));
}

export function deriveEffectiveAudibility({
    tracks,
    soloMode,
    stripTrackIds,
}: EffectiveAudibilityInput): EffectiveAudibility {
    // A fresh, stateless plan: solo-in-place gain bookkeeping (PFL saved gains) is
    // a live-only concern, so audibility is derived from a plan with no carried
    // gain state. Each eligible strip track receives exactly one `setMute`, whose
    // negation is that track's audibility.
    const { actions, soloGatedTrackIds } = applySoloLogic({
        tracks,
        soloMode,
        savedGains: new Map(),
        liveStripTrackIds: stripTrackIds,
    });

    const audibleByTrackId = new Map<string, boolean>();
    const soloGatedByTrackId = new Map<string, boolean>();
    for (const action of actions) {
        if (action.type === 'setMute') {
            audibleByTrackId.set(action.trackId, !action.muted);
            soloGatedByTrackId.set(action.trackId, soloGatedTrackIds.has(action.trackId));
        }
    }

    return { anySoloed: hasActiveSolo({ tracks, stripTrackIds }), audibleByTrackId, soloGatedByTrackId };
}
