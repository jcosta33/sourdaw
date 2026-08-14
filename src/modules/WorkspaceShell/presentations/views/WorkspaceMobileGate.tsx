import { type ReactElement, type ReactNode } from 'react';

import { MobileGate } from '../components/MobileGate';

type WorkspaceMobileGateProps = {
    children: ReactNode;
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
 */
export const WorkspaceMobileGate = ({ children }: WorkspaceMobileGateProps): ReactElement => {
    return <MobileGate>{children}</MobileGate>;
};
