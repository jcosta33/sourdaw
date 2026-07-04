import { type MixAnalysisDisplayLifecycle, setMixAnalysisDisplayLifecyclePort } from './mixAnalysisDisplayLifecycle';

type SetMixAnalysisDisplayLifecycleInput = MixAnalysisDisplayLifecycle;

export function setMixAnalysisDisplayLifecycle(input: SetMixAnalysisDisplayLifecycleInput): void {
    setMixAnalysisDisplayLifecyclePort(input);
}
