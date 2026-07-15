import { sendYeastRuntimeAllNotesOff } from '../../engine/yeastRuntime';

export function yeastPanic(sampleTime: number): Promise<void> {
    return sendYeastRuntimeAllNotesOff(sampleTime);
}
