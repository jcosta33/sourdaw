import {
    type MixAnalysisDisplayLifecycle,
    setMixAnalysisDisplayLifecyclePort,
} from '../handlers/analysis/mixAnalysisDisplayLifecycle';

type SetMixAnalysisDisplayLifecycleInput = MixAnalysisDisplayLifecycle;

export function setMixAnalysisDisplayLifecycle(input: SetMixAnalysisDisplayLifecycleInput): void {
    setMixAnalysisDisplayLifecyclePort(input);
}
