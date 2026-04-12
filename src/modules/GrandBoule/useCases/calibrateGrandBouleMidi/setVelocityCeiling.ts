import { setMidiCalibrationParam } from './helpers';

export const setVelocityCeiling = (value: number): void => {
    setMidiCalibrationParam('velocityCeiling', value);
};