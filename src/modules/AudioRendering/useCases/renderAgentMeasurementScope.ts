import {
    renderAgentMeasurementWindows,
    type AgentMeasurementScopeRefusal,
    type RenderAgentMeasurementWindowsInput,
    type WindowedMeasurementTarget,
} from './renderAgentMeasurementWindows';

type RenderedMeasurementTarget = Omit<WindowedMeasurementTarget, 'windows'> &
    WindowedMeasurementTarget['windows'][number];

type RenderAgentMeasurementScopeInput = Omit<RenderAgentMeasurementWindowsInput, 'windows'> & {
    startBeat: number;
    endBeat: number;
};

type RenderAgentMeasurementScopeResult =
    | {
          status: 'rendered';
          soloActive: boolean;
          targets: RenderedMeasurementTarget[];
          /** Renderer warnings. */
          warnings: string[];
      }
    | AgentMeasurementScopeRefusal
    | { status: 'cancelled' };

/** Render one scope over one beat range: the windowed render with that range as its only window. */
export async function renderAgentMeasurementScope(
    input: RenderAgentMeasurementScopeInput
): Promise<RenderAgentMeasurementScopeResult> {
    const { startBeat, endBeat, ...rest } = input;
    const rendered = await renderAgentMeasurementWindows({ ...rest, windows: [{ startBeat, endBeat }] });
    if (rendered.status !== 'rendered') {
        return rendered;
    }
    return {
        ...rendered,
        targets: rendered.targets.map(({ windows, ...target }) => ({ ...target, ...windows[0]! })),
    };
}
