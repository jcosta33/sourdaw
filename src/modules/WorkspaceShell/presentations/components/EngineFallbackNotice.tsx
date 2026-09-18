import { type ReactElement } from 'react';

import { AlertTriangle, X } from 'lucide-react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

type EngineFallbackNoticeProps = {
    onDismiss: () => void;
};

/**
 * Persistent, non-modal notice that the audio engine fell back to its silent
 * shim, so nothing in the workspace will make sound this session.
 *
 * Rendered once at the shell level, never per device or track: the failure
 * belongs to the engine as a whole (issue #3871). Like the mutation-refusal
 * banner it stays out of the shell's modal set — the workspace it explains
 * stays reachable.
 */
export const EngineFallbackNotice = ({ onDismiss }: EngineFallbackNoticeProps): ReactElement => {
    return (
        <Row
            align="start"
            gap={2}
            role="alert"
            data-testid="engine-fallback-notice"
            className="shrink-0 border-b border-[var(--color-state-danger)]/40 bg-[var(--color-state-danger)]/10 px-3 py-2"
        >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-state-danger)]" aria-hidden="true" />
            <Stack gap={0.5} className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">The audio engine could not start</p>
                <p className="text-xs text-muted-foreground">
                    Playback is silent this session. Restart Sourdaw, and check that an audio output device is connected
                    and not in use by another application.
                </p>
            </Stack>
            <Button variant="ghost" size="icon-xs" onClick={onDismiss} aria-label="Dismiss audio engine notice">
                <X className="size-3.5" />
            </Button>
        </Row>
    );
};
