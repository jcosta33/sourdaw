import { setMidiCalibrationParam } from './helpers';

export const setVelocityFloor = (value: number): void => {
    setMidiCalibrationParam('velocityFloor', value);
};