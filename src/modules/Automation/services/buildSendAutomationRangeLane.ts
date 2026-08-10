import { type AutomationLane, type AutomationPoint } from '../models/Automation';

type BuildSendAutomationRangeLaneInput = {
    trackId: string;
    busId: string;
    busName: string;
    baseLevel: number;
    startBeat: number;
    endBeat: number;
    reductionDb: number;
};

export function buildSendAutomationRangeLane(input: BuildSendAutomationRangeLaneInput): AutomationLane {
    const loweredLevel = input.baseLevel * 10 ** (-input.reductionDb / 20);
    const points: AutomationPoint[] = [];
    if (input.startBeat > 0) {
        points.push({ beat: 0, value: input.baseLevel, curve: 'step', tension: 0 });
    }
    points.push(
        { beat: input.startBeat, value: loweredLevel, curve: 'step', tension: 0 },
        { beat: input.endBeat, value: input.baseLevel, curve: 'step', tension: 0 }
    );
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
