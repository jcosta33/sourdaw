import { type ReactElement } from 'react';

/** The run projection fields this section renders, as a leaf-owned structural shape. */
type AgentProgressView = {
    phase: string;
    cancellation: { requested: boolean; acknowledgement: string };
};

type AgentProgressSectionProps = {
    progress: AgentProgressView | null;
};

/**
 * Phases from which a run never leaves. AiRuntime keeps its phase model private,
 * so the terminal set is restated against the projection's `phase` contract.
 */
const TERMINAL_PHASES: readonly string[] = ['completed', 'failed', 'cancelled', 'partially-completed'];

export const AgentProgressSection = ({ progress }: AgentProgressSectionProps): ReactElement => {
    return (
        <div className="flex flex-col gap-1">
            <section role="status" aria-live="polite" aria-atomic="true" className="flex flex-col gap-1">
                <p className="text-xs text-foreground" data-state={progress?.phase ?? 'none'}>
                    {progress === null ? 'No run selected' : `Phase: ${progress.phase}`}
                </p>
                {progress !== null && progress.cancellation.requested ? (
                    <p
                        className="text-xs text-muted-foreground"
                        data-state={progress.cancellation.acknowledgement}
                    >{`Cancel requested — acknowledgement: ${progress.cancellation.acknowledgement}`}</p>
                ) : null}
            </section>
            {progress !== null && TERMINAL_PHASES.includes(progress.phase) ? (
                <p role="alert" className="text-xs text-foreground">
                    {`Run ${progress.phase}`}
                </p>
            ) : null}
        </div>
    );
};
