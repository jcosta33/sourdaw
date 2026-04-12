import { setMidiCalibrationParam } from './helpers';

export const setVelocityCurveExponent = (value: number): void => {
    setMidiCalibrationParam('velocityCurveExponent', value);
};