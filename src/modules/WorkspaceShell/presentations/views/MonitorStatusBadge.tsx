import { type ReactElement } from 'react';

import { Row } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';
import { type ControlRoomState, controlRoomStore } from '#/modules/ControlRoom/stores';

// Local default so the badge stays quiet before the ControlRoom store hydrates
// (mirrors MidiStatusBadge's defaultWebMidiState). Only the mono/dim flags drive
// this read-only view; the rest satisfies the store's state shape.
const defaultControlRoomState: ControlRoomState = {
    monitors: [],
    activeMonitorId: '',
    monitorVolume: -6,
    dimLevel: -20,
    dimActive: false,
    monoActive: false,
    referenceActive: false,
    talkbackActive: false,
    talkbackLevel: -12,
    cueMixes: [],
    activeCueId: null,
    muted: false,
};

type BuildMonitorLabelInput = {
    monoActive: boolean;
    dimActive: boolean;
};

const buildMonitorLabel = ({ monoActive, dimActive }: BuildMonitorLabelInput): string => {
    const flags: string[] = [];
    if (monoActive) {
        flags.push('Mono');
    }
    if (dimActive) {
        flags.push('Dim');
    }
    return flags.join(' · ');
};

/**
 * Read-only reflection of control-room monitoring state (mono / dim). Renders
 * nothing while both are inactive so the status bar stays quiet by default.
 * Cross-module store READ only — never mutates the ControlRoom store.
 */
export const MonitorStatusBadge = (): ReactElement | null => {
    const state = useStore(controlRoomStore, defaultControlRoomState);
    const monoActive = state.monoActive;
    const dimActive = state.dimActive;

    if (!monoActive && !dimActive) {
        return null;
    }

    const label = buildMonitorLabel({ monoActive, dimActive });
    const ariaLabel = `Monitoring: ${label} active`;

    return (
        <Row
            as="span"
            gap={1}
            className="h-5 rounded px-1.5 text-[10px] text-[var(--color-state-warning)]"
            aria-label={ariaLabel}
            title={ariaLabel}
        >
            <span className="inline-block size-1.5 rounded-full bg-[var(--color-state-warning)]" aria-hidden="true" />
            <span className="tabular-nums">{label}</span>
        </Row>
    );
};
