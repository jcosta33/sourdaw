import { setMidiCalibrationParam } from './helpers';

export const setCcSmoothingMs = (value: number): void => {
    setMidiCalibrationParam('ccSmoothingMs', value);
};