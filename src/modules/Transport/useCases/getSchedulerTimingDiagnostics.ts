import { schedulerTimingDiagnostics } from './playheadScheduler/schedulerTimingDiagnostics';

export function getSchedulerTimingDiagnostics() {
    return schedulerTimingDiagnostics.snapshot();
}
