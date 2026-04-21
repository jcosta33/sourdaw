import { type Store } from '#/infra/store/types';

import { type GrandBouleState } from '../../stores/grandBouleStore';

import { setMidiCalibrationParam } from './helpers';

export function setVelocityCurveExponent(input: { store: Store<GrandBouleState>; value: number }): void {
    setMidiCalibrationParam(input.store, 'velocityCurveExponent', input.value);
}
