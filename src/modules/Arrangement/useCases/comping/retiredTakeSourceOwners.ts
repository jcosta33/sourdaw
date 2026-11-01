import { type RetiredTakeLaneSnapshot, type TakeSnapshot } from '#/utils/handlerContract';

export type SourceKind = 'removeClip' | 'splitClipUndo';

export function sourceOwners(
    clipIds: readonly string[],
    captures: readonly RetiredTakeLaneSnapshot[],
    undoEntryId: string
) {
    // Preserve the complete capture, omitting only unset domain optionals as
    // saved JSON does. Store sanitization could discard meaningful invalid data.
    const owners = captures.map((capture) => {
        const takes = capture.lane.takes.map((take) => {
            const { sourceOffsetBeats, passAnchorSeconds, passDepthSeconds, ...requiredFields } = take;
            const savedTake: TakeSnapshot = requiredFields;
            if (sourceOffsetBeats !== undefined) {
                savedTake.sourceOffsetBeats = sourceOffsetBeats;
            }
            if (passAnchorSeconds !== undefined) {
                savedTake.passAnchorSeconds = passAnchorSeconds;
            }
            if (passDepthSeconds !== undefined) {
                savedTake.passDepthSeconds = passDepthSeconds;
            }
            return savedTake;
        });
        const lane = { ...capture.lane, takes };
        if (lane.automationLaneId === undefined) {
            delete lane.automationLaneId;
        }
        const savedCapture = { ...capture, lane };
        if (savedCapture.retiredTakeIds === undefined) {
            delete savedCapture.retiredTakeIds;
        }
        return savedCapture;
    });
    return { undoEntryId, clipIds: [...clipIds], owners };
}
