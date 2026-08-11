import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';
import { projectShortMidiOverlapRemoval } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { getMidiArticulationSemanticChanges } from '../transformers/getMidiArticulationSemanticChanges';

export function getPlannedActionAffectedIds(action: AppAction): string[] {
    const affectedIds = new Set<string>();
    const payload: Readonly<Record<string, unknown>> = action.payload ?? {};
    if (action.type === 'copyMidiArticulations') {
        affectedIds.add(action.payload.trackId);
    }
    if (action.type === 'removeShortMidiOverlaps') {
        affectedIds.add(action.payload.expectedTrackId);
        affectedIds.add(action.payload.clipId);
        const projected = projectShortMidiOverlapRemoval({
            notes: action.payload.expectedNotes,
            tempo: action.payload.expectedTempo,
            maximumOverlapMs: action.payload.maximumOverlapMs,
        });
        for (const shortened of projected?.shortenedNotes ?? []) {
            affectedIds.add(shortened.noteId);
        }
    }
    if (action.type === 'createDrumPreviewBranches') {
        for (const candidate of action.payload.candidates) {
            affectedIds.add(candidate.branchId);
            affectedIds.add(candidate.rootDocId);
            affectedIds.add(`${candidate.branchId}:${action.payload.snare.clipId}`);
            affectedIds.add(`${candidate.branchId}:${action.payload.hiHat.clipId}`);
        }
    }
    if (action.type === 'setDeviceParameter' && action.payload.expectedTrackId) {
        affectedIds.add(action.payload.expectedTrackId);
    }
    const groundingRules = getExecutableAppActionGroundingRules(action.type);
    for (const targetRule of groundingRules?.targetRules ?? []) {
        const value = payload[targetRule.argument];
        if (typeof value === 'string') {
            affectedIds.add(value);
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === 'string') {
                    affectedIds.add(item);
                }
            }
        }
    }
    if (action.type === 'createBus' && action.payload.busId) {
        affectedIds.add(action.payload.busId);
    }
    if (action.type === 'addDevice' && action.payload.deviceId) {
        affectedIds.add(action.payload.deviceId);
    }
    if (action.type === 'addSidechainRoute') {
        if (action.payload.targetDeviceId) {
            affectedIds.add(action.payload.targetDeviceId);
        }
        if (action.payload.routeId) {
            affectedIds.add(action.payload.routeId);
        }
    }
    if (action.type === 'addAdjustmentRegion') {
        affectedIds.add(action.payload.layerId);
        if (action.payload.regionId) {
            affectedIds.add(action.payload.regionId);
        }
        if (action.payload.targetSection) {
            affectedIds.add(action.payload.targetSection.id);
        }
        for (const track of action.payload.expectedTracks ?? []) {
            affectedIds.add(track.trackId);
        }
    }
    if (action.type === 'automateSendRange' && action.payload.sectionId) {
        affectedIds.add(action.payload.sectionId);
    }
    if (action.type === 'automateTrackGainRange' && action.payload.sectionId) {
        for (const trackId of action.payload.trackIds) {
            affectedIds.add(trackId);
        }
        affectedIds.add(action.payload.sectionId);
    }
    if (action.type === 'automateSendRanges' || action.type === 'removeSendAutomationRanges') {
        affectedIds.add(action.payload.busId);
        for (const trackId of action.payload.trackIds) {
            affectedIds.add(trackId);
            affectedIds.add(`auto-send-${encodeURIComponent(trackId)}-${encodeURIComponent(action.payload.busId)}`);
        }
        for (const sectionId of action.payload.sectionIds) {
            affectedIds.add(sectionId);
        }
    }
    if (action.type === 'renderProjectSections' || action.type === 'removeRenderedProjectSections') {
        for (const sectionId of action.payload.sectionIds) {
            affectedIds.add(sectionId);
        }
        for (const job of action.payload.jobs ?? []) {
            affectedIds.add(job.jobId);
        }
    }
    if (action.type === 'copyMidiArticulations') {
        const changes = getMidiArticulationSemanticChanges({
            notePairs: action.payload.notePairs,
            sourceNotes: action.payload.expectedSourceNotes,
            targetNotes: action.payload.expectedTargetNotes,
        });
        for (const change of changes ?? []) {
            affectedIds.add(change.targetNoteId);
        }
    }
    return [...affectedIds];
}
