import { deriveVcaMultiplier, getVcaGroupsState, trackStore } from '#/modules/Arrangement/stores';
import {
    getCompensationDelay,
    getCurrentTime,
    setTrackGain as engineSetTrackGain,
} from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation, resolveAutoMatchValue } from '#/modules/Automation/useCases';

import { playheadPositionRef } from '../../../stores/playheadPositionRef';

import { scheduleComposedTrackGainAutomation } from './scheduleComposedTrackGainAutomation';

export function reconcileVcaGroupRuntimeGain(vcaGroupId: string): void {
    const currentBeat = playheadPositionRef.current;
    const now = getCurrentTime();
    const tracks = trackStore.value?.tracks ?? [];
    const lanes = automationStore.value?.lanes ?? [];

    for (const track of tracks) {
        if (track.vcaGroupId !== vcaGroupId) {
            continue;
        }

        let automationProjected = false;
        for (const lane of lanes) {
            if (
                lane.trackId !== track.id ||
                lane.parameterId !== 'gain' ||
                lane.points.length === 0 ||
                track.automationMode === 'off' ||
                lane.enabled === false ||
                isRecordingAutomation(lane.trackId, lane.parameterId)
            ) {
                continue;
            }
            if (lane.clipId) {
                const clip = track.clips.find((candidate) => candidate.id === lane.clipId);
                if (!clip || currentBeat < clip.startBeat || currentBeat > clip.endBeat) {
                    continue;
                }
            }
            const curveValue = getAutomationValueAtBeat(lane.id, currentBeat);
            if (curveValue === null) {
                continue;
            }
            const value = resolveAutoMatchValue({
                trackId: lane.trackId,
                parameterId: lane.parameterId,
                automationValue: curveValue,
                nowSeconds: now,
            }).value;
            scheduleComposedTrackGainAutomation({
                trackId: track.id,
                vcaGroupId: track.vcaGroupId,
                value,
                minValue: lane.minValue,
                time: now + getCompensationDelay(track.id),
            });
            automationProjected = true;
        }

        if (!automationProjected) {
            const vcaMultiplier = deriveVcaMultiplier({
                vcaGroupId: track.vcaGroupId,
                groups: getVcaGroupsState(),
            });
            engineSetTrackGain(track.id, track.gain * vcaMultiplier);
        }
    }
}
