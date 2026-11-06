import { type ReactElement, type ReactNode } from 'react';

import { MobileGate } from '../components/MobileGate';
import { useDisplayScaleSynchronization } from '../hooks/useDisplayScaleSynchronization';
import { useThemeSynchronization } from '../hooks/useThemeSynchronization';

type WorkspaceMobileGateProps = {
    children: ReactNode;
};

const AppearanceSynchronizationBoundary = ({ children }: WorkspaceMobileGateProps): ReactElement => {
    useDisplayScaleSynchronization();
    useThemeSynchronization();
    return <>{children}</>;
};

/**
 * Cross-module surface for the mobile device gate.
 *
 * The gate has to sit *above* `AppShell`, not inside it: hooks cannot be conditional,
 * so a check inside the shell still mounts every initialization effect (engine init,
 * project load, MIDI start, synth/effect registration, autosave interval) and only
 * swaps the rendered output. Wrapping the shell means that on an unsupported phone
 * `AppShell` never mounts and none of that work happens on a platform the app declares
 * unsupported. `MobileGate` classifies the device once, from platform identity — a
 * coarse pointer plus `screen` size, never momentary window width — so rotation and
 * resize cannot mount or unmount the shell after that first decision; the contract
 * note on `isUnsupportedPhone` states the rule.
 *
 * Appearance synchronization also belongs here, outside AppShell but inside the
 * mobile gate. The boundary mounts only after `MobileGate` has classified the device
 * as eligible, then reapplies the stored preferences; scale moves window metrics, and
 * the gate never reads them.
 */
export const WorkspaceMobileGate = ({ children }: WorkspaceMobileGateProps): ReactElement => {
    return (
        <MobileGate>
            <AppearanceSynchronizationBoundary>{children}</AppearanceSynchronizationBoundary>
        </MobileGate>
    );
};
