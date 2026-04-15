import { useEffect, useState } from 'react';

import { onPanelShowBacteria } from '../../useCases/panels/devicePanels/onPanelShowBacteria';
import { onPanelShowCrumbs } from '../../useCases/panels/devicePanels/onPanelShowCrumbs';
import { onPanelShowCrust } from '../../useCases/panels/devicePanels/onPanelShowCrust';
import { onPanelShowDutchOven } from '../../useCases/panels/devicePanels/onPanelShowDutchOven';
import { onPanelShowFermenter } from '../../useCases/panels/devicePanels/onPanelShowFermenter';
import { onPanelShowGluten } from '../../useCases/panels/devicePanels/onPanelShowGluten';
import { onPanelShowGrandBoule } from '../../useCases/panels/devicePanels/onPanelShowGrandBoule';
import { onShowDevicePanel } from '../../useCases/panels/devicePanels/onShowDevicePanel';
import { onPanelShowLevain } from '../../useCases/panels/devicePanels/onPanelShowLevain';

import { onPanelShowProof } from '../../useCases/panels/devicePanels/onPanelShowProof';
import { onPanelShowScoring } from '../../useCases/panels/devicePanels/onPanelShowScoring';
import { onPanelShowToaster } from '../../useCases/panels/devicePanels/onPanelShowToaster';
import { onPanelShowYeast } from '../../useCases/panels/devicePanels/onPanelShowYeast';

/**
 * Unified active-device-panel state.
 *
 * Prior to this hook, AppShell held 13 independent useState slots + 13
 * near-identical useEffect subscriptions + a manually maintained
 * `closeAllDevicePanels()` function that had to be kept in sync with every
 * new plugin. (Audit §3.1, §4.2, §47.1.)
 *
 * Constraint: only one device panel can be open at a time — opening one
 * must close any other. That invariant is now enforced by the type system
 * (single discriminated union) rather than by a hand-written setter chain.
 */
export type ActiveDevicePanel =
    | { kind: 'fermenter'; deviceId: string }
    | { kind: 'toaster'; deviceId: string }
    | { kind: 'levain' }
    | { kind: 'proofChamber'; deviceId: string }
    | { kind: 'gluten'; deviceId: string }
    | { kind: 'bacteria'; deviceId: string }
    | { kind: 'grinder'; deviceId: string }
    | { kind: 'scoring'; deviceId: string }
    | { kind: 'proof'; deviceId: string }
    | { kind: 'yeast' }
    | { kind: 'crust'; deviceId: string }
    | { kind: 'sampler'; deviceId: string }
    | { kind: 'grandBoule'; deviceId: string };

type UseActiveDevicePanelResult = {
    activePanel: ActiveDevicePanel | null;
    closeActivePanel: () => void;
};

export function useActiveDevicePanel(): UseActiveDevicePanelResult {
    const [activePanel, setActivePanel] = useState<ActiveDevicePanel | null>(null);

    useEffect(() => {
        // A payload with deviceId === null means "close the panel" — the old
        // AppShell code reached the same outcome by calling setXDeviceId(null).
        type NeedsDeviceId = Exclude<ActiveDevicePanel, { kind: 'levain' } | { kind: 'yeast' }>['kind'];
        const openForKind = (kind: NeedsDeviceId) => (p: { deviceId: string | null }) => {
            setActivePanel(p.deviceId === null ? null : ({ kind, deviceId: p.deviceId } as ActiveDevicePanel));
        };
        const subs = [
            onPanelShowFermenter(openForKind('fermenter')),
            onPanelShowToaster(openForKind('toaster')),
            onPanelShowLevain(() => setActivePanel({ kind: 'levain' })),
            onPanelShowDutchOven(openForKind('proofChamber')),
            onPanelShowGluten(openForKind('gluten')),
            onPanelShowBacteria(openForKind('bacteria')),
            onShowDevicePanel((payload) => {
                if (payload.deviceType === 'grinder') {
                    openForKind('grinder')({ deviceId: payload.deviceId });
                }
            }),
            onPanelShowProof(openForKind('proof')),
            onPanelShowYeast(() => setActivePanel({ kind: 'yeast' })),
            onPanelShowScoring(openForKind('scoring')),
            onPanelShowCrust(openForKind('crust')),
            onPanelShowCrumbs(openForKind('sampler')),
            onPanelShowGrandBoule(openForKind('grandBoule')),
        ];
        return () => {
            for (const unsub of subs) {
                unsub();
            }
        };
    }, []);

    const closeActivePanel = (): void => {
        setActivePanel(null);
    };

    return { activePanel, closeActivePanel };
}
