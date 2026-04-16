import { type Store } from '#/infra/store/types';
import { type GrandBouleState } from '../../stores/grandBouleStore';
import { setMidiCalibrationParam } from './helpers';

export const setVelocityFloor = (input: { store: Store<GrandBouleState>; value: number }): void => {
    setMidiCalibrationParam(input.store, 'velocityFloor', input.value);
};