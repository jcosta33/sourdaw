import { snapToDeclaredLegalValue as modelSnapToDeclaredLegalValue } from '../models/DeviceParameterLaw';

type SnapToDeclaredLegalValueInput = {
    legalValues: readonly number[];
    value: number;
};

export function snapToDeclaredLegalValue({ legalValues, value }: SnapToDeclaredLegalValueInput): number {
    return modelSnapToDeclaredLegalValue({ legalValues, value });
}
