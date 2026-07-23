import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from './automationDeviceTarget';

const SIXTEENTH_NOTE_BEATS = 0.25;

type ToasterSwingDevice = {
    id: string;
    type: string;
    parameterValues: Record<string, number>;
};

type ToasterSwingLane = {
    id: string;
    trackId: string;
    parameterId: string;
    enabled: boolean;
    clipId?: string;
};

type GetToasterSwingOffsetBeatsInput = {
    parentTrackId: string;
    automationMode: string;
    devices: readonly ToasterSwingDevice[];
    lanes: readonly ToasterSwingLane[];
    noteStartBeat: number;
    evaluateAutomationValue: (laneId: string, beat: number) => number | null;
};

function acceptsSwingParameter(device: ToasterSwingDevice, parameterId: string): boolean {
    return device.type === 'toaster' && parameterId === 'swing' && device.parameterValues.swing !== undefined;
}

export function getToasterSwingOffsetBeats({
    parentTrackId,
    automationMode,
    devices,
    lanes,
    noteStartBeat,
    evaluateAutomationValue,
}: GetToasterSwingOffsetBeatsInput): number {
    const sixteenthIndex = Math.round(noteStartBeat / SIXTEENTH_NOTE_BEATS);
    if (automationMode === 'off' || Math.abs(sixteenthIndex) % 2 === 0) {
        return 0;
    }

    let swingValue: number | null = null;
    for (const lane of lanes) {
        if (lane.trackId !== parentTrackId || lane.clipId || !lane.enabled) {
            continue;
        }
        const deviceIndex = resolveDeviceAutomationTargetIndex(lane.parameterId, devices, acceptsSwingParameter);
        const parameterId = getDeviceAutomationParameterId(lane.parameterId);
        if (deviceIndex < 0 || parameterId !== 'swing') {
            continue;
        }
        const value = evaluateAutomationValue(lane.id, noteStartBeat);
        if (value !== null && Number.isFinite(value)) {
            swingValue = value;
        }
    }
    if (swingValue === null) {
        return 0;
    }
    const normalizedSwing = Math.max(0, Math.min(1, swingValue));
    return normalizedSwing * SIXTEENTH_NOTE_BEATS * 0.5;
}
