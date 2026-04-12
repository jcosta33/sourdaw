import { setMidiCalibrationParam } from './helpers';

export const setSustainThreshold = (value: number): void => {
    setMidiCalibrationParam('sustainThreshold', value);
};