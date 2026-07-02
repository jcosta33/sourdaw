import { type Store } from '#/infra/store/types';

import { type GrandBouleState } from '../../stores/grandBouleStore';

import { setMidiCalibrationParam } from './setMidiCalibrationParam';

export function setCcSmoothingMs(input: { store: Store<GrandBouleState>; value: number }): void {
    setMidiCalibrationParam(input.store, 'ccSmoothingMs', input.value);
}
