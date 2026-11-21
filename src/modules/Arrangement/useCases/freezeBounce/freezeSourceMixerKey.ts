import { type AutomationLane } from '#/modules/Automation/stores';
import { canonicalJson } from '#/utils/canonicalDigest';

import { type Track } from '../../models/Track';
import { deriveVcaMultiplier, type VcaGroupState } from '../../stores/vcaGroupStore';

type FreezeSourceMixerKeyInput = {
    track: Track;
    automationLanes: AutomationLane[];
    vcaGroups: VcaGroupState['groups'];
};

/**
 * What a render reads from a source track besides its clips and devices: the strip's fader, pan,
 * mute and VCA multiplier, the output and send wiring, the MIDI routing and frozen take, and the
 * track's automation lanes. The target's own fader and pan stay live under a freeze, so the target
 * never takes this key.
 */
export function freezeSourceMixerKey({ track, automationLanes, vcaGroups }: FreezeSourceMixerKeyInput): string {
    return canonicalJson({
        kind: track.kind,
        gain: track.gain,
        pan: track.pan,
        muted: track.muted,
        outputId: track.outputId,
        sends: track.sends,
        vcaMultiplier: deriveVcaMultiplier({ vcaGroupId: track.vcaGroupId, groups: vcaGroups }),
        midiFx: track.midiFx,
        midiOutputTrackId: track.midiOutputTrackId,
        followChordTrack: track.followChordTrack,
        frozen: track.frozen,
        frozenBufferId: track.frozenBufferId,
        automation: automationLanes.filter((lane) => lane.trackId === track.id),
    });
}
