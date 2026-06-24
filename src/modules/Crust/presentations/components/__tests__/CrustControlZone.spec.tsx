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
});
