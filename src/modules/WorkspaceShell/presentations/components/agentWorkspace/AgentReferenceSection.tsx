import { type ReactElement } from 'react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

type AgentReferenceSectionProps = {
    /** The loaded reference as the user reads it, or `null` while none is loaded. */
    reference: { name: string; loudness: string } | null;
    loading: boolean;
    /** Why the last load left no reference, or `null`. */
    error: string | null;
    onLoad: () => void;
    onClear: () => void;
};

export const AgentReferenceSection = ({
    reference,
    loading,
    error,
    onLoad,
    onClear,
}: AgentReferenceSectionProps): ReactElement => (
    <Stack as="section" gap={1} aria-label="Reference">
        <h4 className="text-xs font-semibold text-foreground">Reference</h4>
        {reference === null ? (
            <p className="text-xs text-muted-foreground">No reference loaded</p>
        ) : (
            <p className="text-xs text-foreground" data-testid="agent-reference-summary">
                {`${reference.name} · ${reference.loudness}`}
            </p>
        )}
        <Row gap={1}>
            <Button
                type="button"
                size="xs"
                variant="secondary"
                disabled={loading}
                className="motion-reduce:transition-none"
                onClick={onLoad}
            >
                {loading ? 'Measuring…' : 'Load reference…'}
            </Button>
            {reference === null ? null : (
                <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="motion-reduce:transition-none"
                    onClick={onClear}
                >
                    Clear reference
                </Button>
            )}
        </Row>
        {error === null ? null : (
            <p role="alert" className="text-xs text-foreground">
                {error}
            </p>
        )}
    </Stack>
);
