import { PROCESSOR_PARAM_DEFAULTS, type ProcessorType } from './ProcessorCatalog';

/** Only the Arpeggiator's independent scalar defaults are materialized on a new rack entry. */
export function createInitialYeastProcessorParams(type: ProcessorType): Record<string, number> {
    return type === 'arpeggiator' ? structuredClone(PROCESSOR_PARAM_DEFAULTS.arpeggiator) : {};
}
