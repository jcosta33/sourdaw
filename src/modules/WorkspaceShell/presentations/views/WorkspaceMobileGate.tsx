import { type ReactElement, type ReactNode } from 'react';

import { MobileGate } from '../components/MobileGate';
import { useDisplayScaleSynchronization } from '../hooks/useDisplayScaleSynchronization';

type WorkspaceMobileGateProps = {
    children: ReactNode;
};

const ScaleSynchronizationBoundary = ({ children }: WorkspaceMobileGateProps): ReactElement => {
    useDisplayScaleSynchronization();
    return <>{children}</>;
};

/**
 * Cross-module surface for the mobile viewport gate.
 *
 * The gate has to sit *above* `AppShell`, not inside it: hooks cannot be conditional,
 * so a check inside the shell still mounts every initialization effect (engine init,
 * project load, MIDI start, synth/effect registration, autosave interval) and only
 * swaps the rendered output. Wrapping the shell means that on a sub-768px viewport
 * `AppShell` never mounts and none of that work happens on a platform the app declares
 * unsupported. Widening past the breakpoint mounts the shell and boots normally; because
 * the gate now owns the shell's mount rather than just its output, `MobileGate`'s
 * viewport check is one-way — see the note on `useIsMobile`.
 *
 * Display-scale synchronization also belongs here, outside AppShell but inside the
 * mobile gate. The boundary mounts only after `MobileGate` has classified the reset,
 * unscaled viewport as desktop eligible, then reapplies the stored preference without
 * allowing scale to turn a phone viewport into an eligible desktop viewport.
 */
export const WorkspaceMobileGate = ({ children }: WorkspaceMobileGateProps): ReactElement => {
    return (
        <MobileGate>
            <ScaleSynchronizationBoundary>{children}</ScaleSynchronizationBoundary>
        </MobileGate>
    );
};
