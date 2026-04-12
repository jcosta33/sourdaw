import { setMidiCalibrationParam } from './helpers';

export const setAfterTouchSensitivity = (value: number): void => {
    setMidiCalibrationParam('afterTouchSensitivity', value);
};