import { Fragment, type ReactElement, type Ref } from 'react';

import { Stack } from '#/components/layout';

type BeatRange = {
    startBeat: number;
    endBeat: number;
};

/**
 * The shapes this section renders. AiRuntime keeps its run model private, so a
 * cross-module consumer states the fields it reads rather than importing them.
 */
type AgentRunSummaryModel = {
    request: string;
    mode: string;
    phase: string;
    scope: {
        targetIds: readonly string[];
        targetRanges: readonly BeatRange[];
        protectedTargetIds: readonly string[];
        protectedRanges: readonly BeatRange[];
    };
    grants: Readonly<Record<string, unknown>>;
};

type AgentRunSummaryProps = {
    run: AgentRunSummaryModel | null;
    headingRef?: Ref<HTMLHeadingElement>;
};

const GRANT_NAMES = [
    'create',
    'delete',
    'routing',
    'tempo',
    'master',
    'file',
    'audioUpload',
    'remoteGeneration',
    'autoCommit',
] as const;

function formatRange(range: BeatRange): string {
    return `${range.startBeat}–${range.endBeat} beats`;
}

function renderIdList(label: string, ids: readonly string[]): ReactElement {
    if (ids.length === 0) {
        return <p className="text-xs text-muted-foreground">{`${label}: none`}</p>;
    }
    return (
        <ul aria-label={label} className="flex flex-wrap gap-1 text-xs text-foreground">
            {ids.map((id) => (
                <li key={id} className="rounded bg-surface-inset px-1.5 py-0.5">
                    {id}
                </li>
            ))}
        </ul>
    );
}

function renderRangeList(label: string, ranges: readonly BeatRange[]): ReactElement {
    if (ranges.length === 0) {
        return <p className="text-xs text-muted-foreground">{`${label}: none`}</p>;
    }
    return (
        <ul aria-label={label} className="flex flex-wrap gap-1 text-xs text-foreground">
            {ranges.map((range) => (
                <li key={`${range.startBeat}-${range.endBeat}`} className="rounded bg-surface-inset px-1.5 py-0.5">
                    {formatRange(range)}
                </li>
            ))}
        </ul>
    );
}

export const AgentRunSummary = ({ run, headingRef }: AgentRunSummaryProps): ReactElement | null => {
    if (run === null) {
        return null;
    }

    const grantedNames = GRANT_NAMES.filter((name) => run.grants[name] === true);

    return (
        <Stack as="section" gap={2} aria-label="Run summary">
            <h3
                ref={headingRef}
                tabIndex={-1}
                className="text-xs font-semibold text-foreground outline-none focus-visible:ring-1 focus-visible:ring-border-focus/70"
            >
                Run summary
            </h3>
            <p className="text-xs text-foreground">{run.request}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Mode</dt>
                <dd className="text-foreground">{run.mode}</dd>
                <dt className="text-muted-foreground">Phase</dt>
                <dd className="text-foreground">{run.phase}</dd>
                <dt className="text-muted-foreground">Targets</dt>
                <dd className="text-foreground">{run.scope.targetIds.length}</dd>
            </dl>
            {renderIdList('Target ids', run.scope.targetIds)}
            {renderRangeList('Target ranges', run.scope.targetRanges)}
            <h4 className="text-xs font-semibold text-foreground">Protections</h4>
            {renderIdList('Protected ids', run.scope.protectedTargetIds)}
            {renderRangeList('Protected ranges', run.scope.protectedRanges)}
            <h4 className="text-xs font-semibold text-foreground">Grants</h4>
            {grantedNames.length === 0 ? (
                <p className="text-xs text-muted-foreground">No authority granted</p>
            ) : (
                <dl aria-label="Granted authority" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    {grantedNames.map((name) => (
                        <Fragment key={name}>
                            <dt className="text-foreground">{name}</dt>
                            <dd className="text-muted-foreground">granted</dd>
                        </Fragment>
                    ))}
                </dl>
            )}
        </Stack>
    );
};
