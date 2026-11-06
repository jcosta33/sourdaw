/**
 * Module URLs of the processors that `repositories/` registers on a context.
 * The engine is a worklet's only application entry point, so repositories take
 * the URLs from here instead of importing `worklets/` themselves.
 */
import bitcrusherRateProcessorUrl from '../worklets/bitcrusherRateProcessor.ts?worker&url';
import meteringProcessorUrl from '../worklets/meteringProcessor.ts?worker&url';
import recordingProcessorUrl from '../worklets/recordingProcessor.ts?worker&url';

export { bitcrusherRateProcessorUrl, meteringProcessorUrl, recordingProcessorUrl };
