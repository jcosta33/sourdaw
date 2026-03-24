export { type TrackLatency, type LatencyReport } from '#/modules/AudioEngine/models/LatencyCompensationTypes';
export {
    reportLatency,
    clearReportedLatency,
    getTrackLatency,
    getMaxTrackLatency,
    getCompensationDelay,
    getLatencyReport,
} from './compensation';
