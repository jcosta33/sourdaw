import { sendYeastRuntimeAllNotesOff } from '../../engine/yeastRuntime';

export function yeastPanic(sampleTime: number): void {
    sendYeastRuntimeAllNotesOff(sampleTime);
}
