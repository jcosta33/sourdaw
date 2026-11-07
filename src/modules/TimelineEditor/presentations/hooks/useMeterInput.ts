import { useStore } from '#/infra/store/useStore';
import { defaultTransportState, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';

const EMPTY_METER_MAP = { changes: [] };

/** The project's meter, in the shape the Transport position formatters take. */
export const useMeterInput = () => {
    const transport = useStore(transportStore, defaultTransportState);
    const meterMap = useStore(timeSignatureMapStore, EMPTY_METER_MAP);
    return {
        changes: meterMap.changes,
        defaultNumerator: transport.timeSignatureNumerator,
        defaultDenominator: transport.timeSignatureDenominator,
    };
};
