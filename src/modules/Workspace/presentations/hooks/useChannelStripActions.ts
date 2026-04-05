import { muteTrack } from '#/modules/Arrangement/useCases/toggleTrackState/muteTrack';
import { soloTrack } from '#/modules/Arrangement/useCases/toggleTrackState/soloTrack';
import { soloTrackExclusive } from '#/modules/Arrangement/useCases/toggleTrackState/soloTrackExclusive';
import { toggleInputMonitoring } from '#/modules/Arrangement/useCases/toggleTrackState/toggleInputMonitoring';
import { toggleSoloSafe } from '#/modules/Arrangement/useCases/toggleTrackState/toggleSoloSafe';
import { selectTrack } from '#/modules/Arrangement/useCases/toggleTrackState/selectTrack';
import { setTrackGain, setTrackPan, setTrackColor } from '#/modules/Arrangement/useCases/setTrackGainPan';
import { armTrack } from '#/modules/Arrangement/useCases/recording';
import { removeTrack } from '#/modules/Arrangement/useCases/removeTrack';
import { renameTrack } from '#/modules/Arrangement/useCases/renameTrack';
import { toggleVcaMembership } from '#/modules/Arrangement/useCases/vca/toggleVcaMembership';
import { createAndAssignVcaGroup } from '#/modules/Arrangement/useCases/vca/createAndAssignVcaGroup';
import { removeTrackFromVCA } from '#/modules/Arrangement/useCases/vcaFader';
import { releaseTouchAutomation } from '#/modules/Automation/useCases/automationRecording/releaseTouchAutomation';
import { type Track } from '../../models/TrackViewTypes';

export type ChannelStripActions = {
    select: () => void;
    toggleMute: () => void;
    toggleSolo: (additive: boolean) => void;
    toggleArm: () => void;
    toggleMonitoring: () => void;
    toggleSoloSafeFlag: () => void;
    setGain: (value: number) => void;
    setPan: (value: number) => void;
    setColor: (color: string) => void;
    rename: (name: string) => void;
    removeWithConfirm: () => void;
    toggleVca: (groupId: string) => void;
    createVcaAndAssign: () => void;
    removeFromVca: () => void;
    releaseGainAutomation: () => void;
    releasePanAutomation: () => void;
};

/**
 * Presentation facade for channel-strip controls. Binds a single `Track` to the set of
 * domain actions a channel strip can dispatch. Centralising the bindings here keeps the
 * strip component thin (one import instead of ~14) and computes toggle targets from the
 * bound track so the view does not branch on current state.
 */
export function useChannelStripActions(track: Track): ChannelStripActions {
    return {
        select: () => selectTrack(track.id),
        toggleMute: () => muteTrack(track.id, !track.muted),
        toggleSolo: (additive) => {
            if (additive) {
                soloTrack(track.id, !track.soloed);
            } else {
                soloTrackExclusive(track.id);
            }
        },
        toggleArm: () => armTrack(track.id, !track.armed),
        toggleMonitoring: () => toggleInputMonitoring(track.id),
        toggleSoloSafeFlag: () => toggleSoloSafe(track.id),
        setGain: (value) => setTrackGain(track.id, value),
        setPan: (value) => setTrackPan(track.id, value),
        setColor: (color) => setTrackColor(track.id, color),
        rename: (name) => renameTrack(track.id, name),
        removeWithConfirm: () => {
            if (window.confirm('Are you sure you want to delete this track? This action cannot be undone.')) {
                removeTrack(track.id);
            }
        },
        toggleVca: (groupId) => toggleVcaMembership(track.id, groupId),
        createVcaAndAssign: () => createAndAssignVcaGroup(track.id),
        removeFromVca: () => removeTrackFromVCA(track.id),
        releaseGainAutomation: () => {
            if (track.automationMode === 'touch') {
                releaseTouchAutomation(track.id, 'gain');
            }
        },
        releasePanAutomation: () => {
            if (track.automationMode === 'touch') {
                releaseTouchAutomation(track.id, 'pan');
            }
        },
    };
}
