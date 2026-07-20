import { type ReactElement } from 'react';

import { useStore } from '#/infra/store/useStore';
import { cvGateStore, defaultCvGateState } from '#/modules/CvGate/stores';

/**
 * Read-only reflection of configured CV/Gate outputs. CV outputs are a global
 * modular-synth routing list (not track-scoped), so the status bar is the
 * honest surface. Renders nothing while no outputs are configured.
 * Cross-module store READ only — never mutates the CvGate store.
 */
export const CvOutputStatusBadge = (): ReactElement | null => {
    const state = useStore(cvGateStore, defaultCvGateState);
    const count = state.outputs.length;

    if (count === 0) {
        return null;
    }

    const label = `${count} CV/Gate`;
    const ariaLabel = `${count} CV/Gate output${count === 1 ? '' : 's'} configured`;

    return (
        <span
            className="flex h-5 items-center gap-1 rounded px-1.5 text-[10px] text-[var(--color-accent-cyan)]"
            aria-label={ariaLabel}
            title={ariaLabel}
        >
            <span className="inline-block size-1.5 rounded-full bg-[var(--color-accent-cyan)]" aria-hidden="true" />
            <span className="tabular-nums">{label}</span>
        </span>
    );
};
