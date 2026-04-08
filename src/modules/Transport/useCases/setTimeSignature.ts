import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '../repositories/transport';

const VALID_DENOMINATORS = [2, 4, 8, 16] as const;

export const setTimeSignature = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function setTimeSignature(numerator: number, denominator: number): void {
            if (numerator < 1 || numerator > 32) {
                return;
            }
            if (!VALID_DENOMINATORS.includes(denominator as (typeof VALID_DENOMINATORS)[number])) {
                return;
            }

            const state = getTransportState();
            if (!state) {
                return;
            }

            updateTransportState({
                timeSignatureNumerator: numerator,
                timeSignatureDenominator: denominator,
            });
        }
);
