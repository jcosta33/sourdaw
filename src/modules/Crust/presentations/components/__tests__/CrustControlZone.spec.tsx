import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type CrustPatch, DEFAULT_CRUST_PATCH } from '../../../models/CrustPatch';
import { CrustControlZone } from '../CrustControlZone';

describe('CrustControlZone', () => {
    it('renders style tiles and hides advanced controls at the default Play tier', () => {
        render(
            <CrustControlZone
                patch={DEFAULT_CRUST_PATCH}
                setParam={vi.fn()}
                lufsIntegrated={-14}
                lufsShortTerm={-14}
                lufsMomentary={-14}
                lra={4}
                truepeakMax={-1}
                grDb={0}
            />
        );

        for (const style of ['TRANSPARENT', 'PUNCHY', 'LOUD']) {
            expect(screen.getByRole('button', { name: `Style ${style}` })).toBeInTheDocument();
        }
        expect(screen.queryByText('Algorithm')).not.toBeInTheDocument();
        expect(screen.queryByRole('switch', { name: /attack auto/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('switch', { name: /release auto/i })).not.toBeInTheDocument();
    });

    it('renders algorithm controls at the Shape tier', () => {
        render(
            <CrustControlZone
                patch={{ ...DEFAULT_CRUST_PATCH, uiLevel: 2 }}
                setParam={vi.fn()}
                lufsIntegrated={-14}
                lufsShortTerm={-14}
                lufsMomentary={-14}
                lra={4}
                truepeakMax={-1}
                grDb={0}
            />
        );
        expect(screen.getByText(/algorithm/i)).toBeInTheDocument();
    });

    // NOTE on the `setParam` per-key type-safety fix (widened Setter -> generic
    // `<K extends keyof CrustPatch>(key: K, value: CrustPatch[K])`):
    // the defect is purely compile-time and has NO runtime manifestation. Its
    // compile-time guarantee lives at the call site in CrustControlZone.tsx
    // (where `setParam('algorithm', 7)` fails to compile) and is now enforced by
    // the spec-inclusive `pnpm typecheck:test` gate. The test below instead pins
    // the runtime wiring — that each pill forwards the correctly-typed value to
    // `setParam`.
    it('forwards the algorithm id to setParam when a pill is clicked', () => {
        const setParam = vi.fn<(key: keyof CrustPatch, value: unknown) => void>();
        render(
            <CrustControlZone
                patch={{ ...DEFAULT_CRUST_PATCH, uiLevel: 2 }}
                setParam={setParam}
                lufsIntegrated={-14}
                lufsShortTerm={-14}
                lufsMomentary={-14}
                lra={4}
                truepeakMax={-1}
                grDb={0}
            />
        );

        fireEvent.click(screen.getByText('Punchy'));
        expect(setParam).toHaveBeenCalledTimes(1);
        expect(setParam).toHaveBeenCalledWith('algorithm', 'punchy');
    });

    // Obs 7: attack "auto" and a literal 0 ms must be independent. Toggling Auto
    // off writes only `attackAuto`, leaving `attack` untouched — so the
    // previously-unreachable `attack=0, attackAuto=false` state is now reachable.
    // The old UI coupled them (dialing 0 forced auto), so any write of `attack`
    // alongside this toggle would be a regression.
    it('toggles attackAuto without touching the attack value', () => {
        const setParam = vi.fn<(key: keyof CrustPatch, value: unknown) => void>();
        const patch: CrustPatch = { ...DEFAULT_CRUST_PATCH, uiLevel: 2, attack: 0, attackAuto: true };
        render(
            <CrustControlZone
                patch={patch}
                setParam={setParam}
                lufsIntegrated={-14}
                lufsShortTerm={-14}
                lufsMomentary={-14}
                lra={4}
                truepeakMax={-1}
                grDb={0}
            />
        );

        fireEvent.click(screen.getByRole('switch', { name: /attack auto/i }));

        expect(setParam).toHaveBeenCalledTimes(1);
        expect(setParam).toHaveBeenCalledWith('attackAuto', false);
        expect(setParam).not.toHaveBeenCalledWith('attack', expect.anything());
    });

    it('toggles releaseAuto without touching the release value', () => {
        const setParam = vi.fn<(key: keyof CrustPatch, value: unknown) => void>();
        const patch: CrustPatch = { ...DEFAULT_CRUST_PATCH, uiLevel: 2, release: 0, releaseAuto: true };
        render(
            <CrustControlZone
                patch={patch}
                setParam={setParam}
                lufsIntegrated={-14}
                lufsShortTerm={-14}
                lufsMomentary={-14}
                lra={4}
                truepeakMax={-1}
                grDb={0}
            />
        );

        fireEvent.click(screen.getByRole('switch', { name: /release auto/i }));

        expect(setParam).toHaveBeenCalledTimes(1);
        expect(setParam).toHaveBeenCalledWith('releaseAuto', false);
        expect(setParam).not.toHaveBeenCalledWith('release', expect.anything());
    });
});
