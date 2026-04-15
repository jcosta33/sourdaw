import { type Store } from '#/infra/store/types';
import { type GrandBouleState } from '../../stores/grandBouleStore';
import { setMidiCalibrationParam } from './helpers';

export const setSustainThreshold = (input: { store: Store<GrandBouleState>; value: number }): void => {
    setMidiCalibrationParam(input.store, 'sustainThreshold', input.value);
};