/**
 * Re-exports the registration entry point from `services/releasedStripReportSink`
 * so the module barrel can publish it without reaching outside `useCases/`
 * (`contract-barrel-scope`). See that file for why the sink itself lives there.
 */
export { registerReleasedStripReportSink } from '../../services/releasedStripReportSink';
