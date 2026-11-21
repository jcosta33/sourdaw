import { capturesNativeCalibration as answerByDeviceType } from '../../models/NativeCalibrationByDeviceType';

/** True for a device type whose native body takes calibration state captured with the document. */
export function capturesNativeCalibration(deviceType: string): boolean {
    return answerByDeviceType(deviceType);
}
