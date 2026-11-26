import { deriveVcaMultiplier, type getVcaGroupsState, type Track } from '#/modules/Arrangement/stores';

export type ResolveContributorVcaMultiplierInput = {
    track: Track;
    isTarget: boolean;
    groups: ReturnType<typeof getVcaGroupsState>;
    /**
     * Whether the target itself should also receive its group master. See
     * `includeTargetVca` on `renderTrackSubgraphOffline` for the rule this
     * flips.
     */
    includeTargetVca?: boolean;
};

/**
 * The VCA group master to bake into one track of this render.
 *
 * **Upstream contributors always get it.** Their audio is summed into the print
 * exactly once and is never recomposed afterwards: the routing edge that got
 * baked stops carrying live signal the moment the target is frozen, so whatever
 * their group master was worth has to be in the samples or it is lost for good.
 *
 * **The target does not, by default.** Freeze and bounce replay their buffer
 * through the very strip that stays live afterwards, and `applyVcaGains` / the
 * gain-automation branch keep driving that same fader — baking the multiplier
 * in here would apply the group twice, once in the buffer and again on the
 * fader the buffer is replayed through.
 *
 * **`includeTargetVca` opts the target in.** A measurement's render is never
 * replayed through a live strip — nothing downstream will ever apply the
 * group again — so leaving it out here would drop it from the measured figure
 * entirely rather than double it. Freeze and bounce never set this; only a
 * caller whose buffer is the end of the line does.
 */
export function resolveContributorVcaMultiplier({
    track,
    isTarget,
    groups,
    includeTargetVca = false,
}: ResolveContributorVcaMultiplierInput): number {
    if (isTarget && !includeTargetVca) {
        return 1;
    }

    return deriveVcaMultiplier({ vcaGroupId: track.vcaGroupId, groups });
}
