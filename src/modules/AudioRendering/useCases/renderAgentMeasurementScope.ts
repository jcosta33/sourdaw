import { resolveAgentMeasurementTargets } from '#/modules/Arrangement/useCases';
import { isExportActive } from '#/modules/AudioEngine/useCases';

import { renderAgentMeasurementTargets } from './renderAgentMeasurementTargets';

type MeasurementScope = Parameters<typeof resolveAgentMeasurementTargets>[0];
type TargetsRender = Awaited<ReturnType<typeof renderAgentMeasurementTargets>>;
type RenderedMeasurementTarget = Extract<TargetsRender, { status: 'rendered' }>['targets'][number];

type RenderAgentMeasurementScopeInput = {
    scope: MeasurementScope;
    startBeat: number;
    endBeat: number;
    /** The revision the caller read the project at; every render must still describe it. */
    sourceRevision: string;
    signal?: AbortSignal;
    /** Called as each target's render begins. */
    onRenderStart?: () => void;
};

type MeasurementScopeRefusalCode =
    | Extract<ReturnType<typeof resolveAgentMeasurementTargets>, { status: 'refused' }>['code']
    | Extract<TargetsRender, { status: 'refused' }>['code']
    | 'render-busy';

type RenderAgentMeasurementScopeResult =
    | {
          status: 'rendered';
          soloActive: boolean;
          targets: RenderedMeasurementTarget[];
          /** Renderer warnings. */
          warnings: string[];
      }
    | {
          status: 'refused';
          code: MeasurementScopeRefusalCode;
          targetId: string | null;
          contributorId: string | null;
      }
    | { status: 'cancelled' };

/**
 * Render every target of one agent measurement scope offline at the caller's
 * project revision.
 *
 * Targets are resolved and every refusal is decided before anything renders.
 * The live revision is compared before and after each render; a mismatch, an
 * abort, or a failed render yields no render from the whole scope. Nothing is
 * retained here: the caller retains the renders once it has reported on them
 * (`retainAgentMeasurementRenders`), so a measurement that stops first leaves
 * the artifact store exactly as it found it.
 */
export async function renderAgentMeasurementScope(
    input: RenderAgentMeasurementScopeInput
): Promise<RenderAgentMeasurementScopeResult> {
    if (input.signal?.aborted) {
        return { status: 'cancelled' };
    }
    const resolution = resolveAgentMeasurementTargets(input.scope);
    if (resolution.status === 'refused') {
        return resolution;
    }
    if (input.scope.kind === 'master' && isExportActive()) {
        return { status: 'refused', code: 'render-busy', targetId: null, contributorId: null };
    }
    const warnings: string[] = [];
    const rendered = await renderAgentMeasurementTargets({
        targets: resolution.targets,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        sourceRevision: input.sourceRevision,
        signal: input.signal,
        onRenderStart: input.onRenderStart,
        onWarning: (message) => warnings.push(message),
    });
    if (rendered.status !== 'rendered') {
        return rendered;
    }
    return { status: 'rendered', soloActive: resolution.soloActive, targets: rendered.targets, warnings };
}
