import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type CrustPatch, DEFAULT_CRUST_PATCH } from '../../../models/CrustPatch';
import { CrustControlZone } from '../CrustControlZone';

describe('CrustControlZone', () => {
    it('should render', () => {
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
        expect(screen.getByText(/algorithm/i)).toBeInTheDocument();
    });

    // NOTE on the `setParam` per-key type-safety fix (widened Setter -> generic
    // `<K extends keyof CrustPatch>(key: K, value: CrustPatch[K])`):
    // the defect is purely compile-time and has NO runtime manifestation. The
    // only seam that could assert it is a type-level `@ts-expect-error`, but this
    // repo never type-checks spec files — `tsconfig.json` excludes
    // `src/**/*.spec.ts*` and `tsconfig.test.json` includes only the Yeast
    // processors — so such a directive would be a dead, unverified test giving
    // false confidence. The fix's guarantee therefore lives at the call site in
    // CrustControlZone.tsx (where `setParam('algorithm', 7)` now fails to
    // compile), not in this suite. The test below instead pins the runtime wiring
    // — that each pill forwards the correctly-typed value to `setParam`.
    it('forwards the algorithm id to setParam when a pill is clicked', () => {
        const setParam = vi.fn<(key: keyof CrustPatch, value: unknown) => void>();
        render(
            <CrustControlZone
                patch={DEFAULT_CRUST_PATCH}
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
        expect(setParam).toHaveBeenCalledWith('algorithm', 'punchy');
    });

    // Obs 7: attack "auto" and a literal 0 ms must be independent. Toggling Auto
    // off writes only `attackAuto`, leaving `attack` untouched — so the
    // previously-unreachable `attack=0, attackAuto=false` state is now reachable.
    // The old UI coupled them (dialing 0 forced auto), so any write of `attack`
    // alongside this toggle would be a regression.
    it('toggles attackAuto without touching the attack value', () => {
        const setParam = vi.fn<(key: keyof CrustPatch, value: unknown) => void>();
        const patch: CrustPatch = { ...DEFAULT_CRUST_PATCH, attack: 0, attackAuto: true };
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

        expect(setParam).toHaveBeenCalledWith('attackAuto', false);
        expect(setParam).not.toHaveBeenCalledWith('attack', expect.anything());
    });

    it('toggles releaseAuto without touching the release value', () => {
        const setParam = vi.fn<(key: keyof CrustPatch, value: unknown) => void>();
        const patch: CrustPatch = { ...DEFAULT_CRUST_PATCH, release: 0, releaseAuto: true };
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

        expect(setParam).toHaveBeenCalledWith('releaseAuto', false);
        expect(setParam).not.toHaveBeenCalledWith('release', expect.anything());
    });
});
