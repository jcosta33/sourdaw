/**
 * How an internal replay action's arguments are admitted into the undo session mirror.
 *
 * - `optional`: the neutral Command argument schema decides; an owner validator may only narrow it.
 * - `required`: the neutral schema must pass and the owner validator must exist and accept.
 * - `owner-only`: the owner captures are wider than the neutral snapshot, so only the owner validator
 *   decides, without widening executable discovery.
 */
export type InternalReplayOwnerValidation = 'optional' | 'required' | 'owner-only';

export const internalReplayOwnerValidationByActionType = {
    discardRecording: 'optional',
    restoreRecording: 'owner-only',
    discardCreatedTrack: 'optional',
    discardDuplicatedClip: 'optional',
    discardDrawnClip: 'optional',
    restoreDevice: 'optional',
    restoreClipMoves: 'optional',
    restoreClip: 'owner-only',
    restoreClipPlacement: 'required',
    restoreClipSplitState: 'required',
    restoreStripSilenceState: 'required',
    restoreAudioClipStartTrim: 'owner-only',
    restoreAudioClipSlip: 'owner-only',
    restoreDrawnClip: 'optional',
    restoreMidiClipNotes: 'required',
    restoreAutomationPointPresence: 'required',
    removeTrackGainAutomationRange: 'required',
    removeSendAutomationRange: 'required',
    removeSendAutomationRanges: 'required',
    removeAutomationLane: 'required',
    restoreAutomationLanePoints: 'required',
    restoreTimeOperationState: 'owner-only',
    restoreCompRegionInterval: 'required',
    restoreTempoEdit: 'required',
    restoreTempoMapEdit: 'required',
    deleteGrooveTemplate: 'optional',
    restoreGrooveAssignment: 'optional',
    restoreTrackHeights: 'optional',
} as const satisfies Readonly<Record<string, InternalReplayOwnerValidation>>;

export type InternalReplayActionType = keyof typeof internalReplayOwnerValidationByActionType;
