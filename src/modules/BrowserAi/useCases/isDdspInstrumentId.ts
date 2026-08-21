import { DDSP_INSTRUMENT_CATALOG, type DdspInstrumentId } from '../models/DdspInstrumentCatalog';

export function isDdspInstrumentId(value: string): value is DdspInstrumentId {
    return DDSP_INSTRUMENT_CATALOG.some((instrument) => instrument.id === value);
}
