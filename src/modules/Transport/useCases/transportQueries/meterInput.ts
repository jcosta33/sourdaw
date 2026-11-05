import { type TimeSignatureChange } from '../../models/TimeSignatureMap';

/** The meter a musical-position query reads: the map's changes and the transport meter before the first. */
export type MeterInput = {
    changes: readonly TimeSignatureChange[];
    defaultNumerator: number;
    defaultDenominator: number;
};
