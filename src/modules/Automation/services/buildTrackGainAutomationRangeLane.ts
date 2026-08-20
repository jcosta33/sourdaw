import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type AutomationLane, type AutomationPoint } from '../models/Automation';

type BuildTrackGainAutomationRangeLaneInput = {
    trackId: string;
    trackName: string;
    baseGain: number;
    startBeat: number;
    endBeat: number;
    gainDb: number;
};

export function buildTrackGainAutomationRangeLane(input: BuildTrackGainAutomationRangeLaneInput): AutomationLane {
    const liftedGain = input.baseGain * 10 ** (input.gainDb / 20);
    const points: AutomationPoint[] = [];
    if (input.startBeat > 0) {
        points.push({ beat: 0, value: input.baseGain, curve: 'step', tension: 0 });
    }
    points.push(
        { beat: input.startBeat, value: liftedGain, curve: 'step', tension: 0 },
        { beat: input.endBeat, value: input.baseGain, curve: 'step', tension: 0 }
    );
    return {
        id: `auto-gain-${encodeURIComponent(input.trackId)}`,
        trackId: input.trackId,
        parameterId: 'gain',
        parameterName: `${input.trackName} Gain`,
        points,
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: FADER_MAX_GAIN,
    };
}
