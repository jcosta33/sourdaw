import { useEffect, useState } from 'react';

import { trackStore } from '#/modules/Arrangement/stores';

import { onPanelShowBacteria } from '../../useCases/panels/devicePanels/onPanelShowBacteria';
import { onPanelShowCrumbs } from '../../useCases/panels/devicePanels/onPanelShowCrumbs';
import { onPanelShowCrust } from '../../useCases/panels/devicePanels/onPanelShowCrust';
import { onPanelShowDutchOven } from '../../useCases/panels/devicePanels/onPanelShowDutchOven';
import { onPanelShowFermenter } from '../../useCases/panels/devicePanels/onPanelShowFermenter';
import { onPanelShowGluten } from '../../useCases/panels/devicePanels/onPanelShowGluten';
import { onPanelShowGrandBoule } from '../../useCases/panels/devicePanels/onPanelShowGrandBoule';
import { onPanelShowLevain } from '../../useCases/panels/devicePanels/onPanelShowLevain';
import { onPanelShowProof } from '../../useCases/panels/devicePanels/onPanelShowProof';
import { onPanelShowScoring } from '../../useCases/panels/devicePanels/onPanelShowScoring';
import { onPanelShowToaster } from '../../useCases/panels/devicePanels/onPanelShowToaster';
import { onPanelShowYeast } from '../../useCases/panels/devicePanels/onPanelShowYeast';
import { onShowDevicePanel } from '../../useCases/panels/devicePanels/onShowDevicePanel';

/**
 * Unified active-device-panel state.
 *
 * Only one device panel can be open at a time — opening one must close any
 * other. That invariant is enforced by the type system (single discriminated
 * union) rather than by a hand-written setter chain across N useState slots.
 *
 * Track-scoping invariant: every panel opened while a track is selected
 * captures the owning `trackId` at open time, and the hook subscribes
 * directly to `trackStore`. When the current selection no longer matches the
 * captured `trackId`, the panel is closed. This catches any path that
 * mutates `selectedTrackId`, including code that bypasses `selectTrack`.
 * Panels opened with no active track (e.g. Levain from the sidebar
 * instruments browser, `trackId === null`) stay open across selection
 * changes, matching the "global" opening semantics.
 */
export type ActiveDevicePanel =
    | { kind: 'fermenter'; deviceId: string; trackId: string | null }
    | { kind: 'toaster'; deviceId: string; trackId: string | null }
    | { kind: 'levain'; trackId: string | null }
    | { kind: 'proofChamber'; deviceId: string; trackId: string | null }
    | { kind: 'gluten'; deviceId: string; trackId: string | null }
    | { kind: 'bacteria'; deviceId: string; trackId: string | null }
    | { kind: 'grinder'; deviceId: string; trackId: string | null }
    | { kind: 'scoring'; deviceId: string; trackId: string | null }
    | { kind: 'proof'; deviceId: string; trackId: string | null }
    | { kind: 'yeast'; trackId: string | null }
    | { kind: 'crust'; deviceId: string; trackId: string | null }
    | { kind: 'sampler'; deviceId: string; trackId: string | null }
    | { kind: 'grandBoule'; deviceId: string; trackId: string | null };

type UseActiveDevicePanelResult = {
    activePanel: ActiveDevicePanel | null;
    closeActivePanel: () => void;
};

export function useActiveDevicePanel(): UseActiveDevicePanelResult {
    const [activePanel, setActivePanel] = useState<ActiveDevicePanel | null>(null);

    useEffect(() => {
        type NeedsDeviceId = Exclude<ActiveDevicePanel, { kind: 'levain' } | { kind: 'yeast' }>['kind'];
        const currentTrackId = (): string | null => trackStore.value?.selectedTrackId ?? null;
        const openForKind = (kind: NeedsDeviceId) => (p: { deviceId: string | null }) => {
            if (p.deviceId === null) {
                setActivePanel(null);
                return;
            }
            setActivePanel({ kind, deviceId: p.deviceId, trackId: currentTrackId() } as ActiveDevicePanel);
        };
        const subs = [
            onPanelShowFermenter(openForKind('fermenter')),
            onPanelShowToaster(openForKind('toaster')),
            onPanelShowLevain(() => setActivePanel({ kind: 'levain', trackId: currentTrackId() })),
            onPanelShowDutchOven(openForKind('proofChamber')),
            onPanelShowGluten(openForKind('gluten')),
            onPanelShowBacteria(openForKind('bacteria')),
            onShowDevicePanel((payload) => {
                if (payload.deviceType === 'grinder') {
                    openForKind('grinder')({ deviceId: payload.deviceId });
                }
            }),
            onPanelShowProof(openForKind('proof')),
            onPanelShowYeast(() => setActivePanel({ kind: 'yeast', trackId: currentTrackId() })),
            onPanelShowScoring(openForKind('scoring')),
            onPanelShowCrust(openForKind('crust')),
            onPanelShowCrumbs(openForKind('sampler')),
            onPanelShowGrandBoule(openForKind('grandBoule')),
            trackStore.subscribe((state) => {
                const nextSelected = state?.selectedTrackId ?? null;
                setActivePanel((panel) => {
                    if (panel === null) {
                        return panel;
                    }
                    if (panel.trackId === null) {
                        return panel;
                    }
                    if (panel.trackId === nextSelected) {
                        return panel;
                    }
                    return null;
                });
            }),
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
