import { type Store } from '#/infra/store/types';
import { type GrandBouleState } from '../../stores/grandBouleStore';
import { setMidiCalibrationParam } from './helpers';

export const setCcSmoothingMs = (input: { store: Store<GrandBouleState>; value: number }): void => {
    setMidiCalibrationParam(input.store, 'ccSmoothingMs', input.value);
};