import { type renderAgentMeasurementScope } from '#/modules/AudioRendering/useCases';

import { type MeasurementFailure } from '../models/MeasurementBudget';

import { type parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';

type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];
type ScopeRefusal = Extract<Awaited<ReturnType<typeof renderAgentMeasurementScope>>, { status: 'refused' }>;

/** A refused project render as the measurement failure its receipt reports. */
export function projectRefusalFailure(refusal: ScopeRefusal, scope: ParsedArguments['scope']): MeasurementFailure {
    const target = refusal.targetId ?? 'master';
    const failures: Readonly<Record<ScopeRefusal['code'], Omit<MeasurementFailure, 'code'>>> = {
        'unknown-target': { safeMessage: `Target ${target} is not in the project.`, retryable: true },
        'kind-mismatch': {
            safeMessage: `Target ${target} is not one of the ${scope.kind} this scope names.`,
            retryable: true,
        },
        'muted-contributor': {
            safeMessage: `Target ${target} cannot be measured in isolation: its muted contributor ${String(refusal.contributorId)} would be rendered unmuted.`,
            retryable: false,
        },
        'disabled-contributor': {
            safeMessage: `Target ${target} cannot be measured in isolation: its disabled contributor ${String(refusal.contributorId)} builds no live strip.`,
            retryable: false,
        },
        'render-busy': { safeMessage: 'Another offline render is in progress.', retryable: true },
        'stale-revision': {
            safeMessage: 'The project changed while it was being measured; read it again before measuring.',
            retryable: true,
        },
        'empty-render': { safeMessage: `The render of ${target} holds no audio.`, retryable: false },
        'render-failed': { safeMessage: `The render of ${target} failed.`, retryable: false },
    };
    return { code: refusal.code, ...failures[refusal.code] };
}
