import { trackStore } from '#/modules/Arrangement/stores';
import { getEffectiveGain } from '#/modules/Arrangement/useCases';
import { setTrackGain as engineSetTrackGain } from '#/modules/AudioEngine/useCases';

/**
 * Drive the effective (track × VCA-group) gain onto each VCA-member track's
 * fader. `ownedGainTrackIds` are the tracks whose fader gain the live automation
 * path already composed and wrote this tick (it folds the same VCA multiplier
 * in); those are skipped so the two writers compose instead of competing —
 * automation's per-tick cancelScheduledValues would otherwise erase the
 * setTargetAtTime issued here. Must run AFTER applyAutomation so the set is
 * populated.
 */
export function applyVcaGains(ownedGainTrackIds: ReadonlySet<string> = new Set()): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }
    for (const track of tracks) {
        if (!track.vcaGroupId || track.muted || ownedGainTrackIds.has(track.id)) {
            continue;
        }
        const effective = getEffectiveGain(track.id, track.gain);
        engineSetTrackGain(track.id, effective);
    }
}
