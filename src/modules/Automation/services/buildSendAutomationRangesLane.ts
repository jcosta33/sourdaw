import { type SendAutomationRangeSnapshot } from '#/utils/handlerContract';

import { type AutomationLane, type AutomationPoint } from '../models/Automation';

type BuildSendAutomationRangesLaneInput = {
    trackId: string;
    busId: string;
    busName: string;
    baseLevel: number;
    targetLevelDb: number;
    ranges: readonly SendAutomationRangeSnapshot[];
};

export function buildSendAutomationRangesLane(input: BuildSendAutomationRangesLaneInput): AutomationLane {
    const targetLevel = 10 ** (input.targetLevelDb / 20);
    const points: AutomationPoint[] = [];
    const firstRange = input.ranges[0];
    if (firstRange && firstRange.automationStartBeat > 0) {
        points.push({ beat: 0, value: input.baseLevel, curve: 'step', tension: 0 });
    }
    for (const range of input.ranges) {
        points.push(
            { beat: range.automationStartBeat, value: input.baseLevel, curve: 'linear', tension: 0 },
            { beat: range.endBeat, value: targetLevel, curve: 'step', tension: 0 },
            { beat: range.endBeat, value: input.baseLevel, curve: 'step', tension: 0 }
        );
    }
    return {
        id: `auto-send-${encodeURIComponent(input.trackId)}-${encodeURIComponent(input.busId)}`,
        trackId: input.trackId,
        parameterId: `send:${input.busId}`,
        parameterName: `Send: ${input.busName}`,
        points,
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}
