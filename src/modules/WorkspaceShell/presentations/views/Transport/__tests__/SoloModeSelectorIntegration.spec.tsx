import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { defaultSoloModeState, soloModeStore } from '#/modules/Arrangement/stores';
import { setSoloMode } from '#/modules/Arrangement/useCases';

import { SoloModeSelector } from '../SoloModeSelector';

function OwnerSelector() {
    const state = useStore(soloModeStore, defaultSoloModeState);
    return (
        <TooltipProvider>
            <SoloModeSelector soloMode={state.soloMode} />
        </TooltipProvider>
    );
}

afterEach(() => {
    cleanup();
    setSoloMode('sip');
});

describe('Solo mode selector', () => {
    // Covers the radio identities and transitions formerly in soloModeTestId.
    it('cycles the real solo owner through AFL, PFL, and SIP', () => {
        setSoloMode('sip');
        render(<OwnerSelector />);
        const sip = screen.getByTestId('solo-mode-sip');
        const afl = screen.getByTestId('solo-mode-afl');
        const pfl = screen.getByTestId('solo-mode-pfl');
        expect(sip).toHaveAttribute('aria-checked', 'true');
        expect(afl).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(afl);
        expect(sip).toHaveAttribute('aria-checked', 'false');
        expect(afl).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(pfl);
        expect(afl).toHaveAttribute('aria-checked', 'false');
        expect(pfl).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(sip);
        expect(pfl).toHaveAttribute('aria-checked', 'false');
        expect(sip).toHaveAttribute('aria-checked', 'true');
    });
});
