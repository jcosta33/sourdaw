import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnswerEvidenceDisclosure } from '../AnswerEvidenceDisclosure';

const EVIDENCE = [
    { callId: 'call-1', toolName: 'analysis.measure', summary: 'Measured the mix bus: -14.2 LUFS.' },
    { callId: 'call-2', toolName: 'project.query', summary: 'Read 8 tracks.' },
] as const;

describe('AnswerEvidenceDisclosure', () => {
    it('starts collapsed: the toggle reports collapsed and no receipt is listed', () => {
        render(<AnswerEvidenceDisclosure evidence={EVIDENCE} />);

        expect(screen.getByRole('button', { name: /Evidence/ })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('analysis.measure')).not.toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Evidence' })).not.toBeInTheDocument();
    });

    it('expands on pointer activation and lists each receipt tool name and summary', () => {
        render(<AnswerEvidenceDisclosure evidence={EVIDENCE} />);

        fireEvent.click(screen.getByRole('button', { name: /Evidence/ }));

        expect(screen.getByRole('button', { name: /Evidence/ })).toHaveAttribute('aria-expanded', 'true');
        const items = screen.getAllByRole('listitem');
        expect(items.map((item) => item.textContent)).toEqual([
            'analysis.measure: Measured the mix bus: -14.2 LUFS.',
            'project.query: Read 8 tracks.',
        ]);
    });

    it('collapses again when the toggle is activated a second time', () => {
        render(<AnswerEvidenceDisclosure evidence={EVIDENCE} />);
        const toggle = screen.getByRole('button', { name: /Evidence/ });

        fireEvent.click(toggle);
        fireEvent.click(toggle);

        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('list', { name: 'Evidence' })).not.toBeInTheDocument();
    });

    // Enter and Space activate a focusable native button; jsdom does not synthesize that click from
    // a key event, so the keyboard contract is the element: a tabbable <button type="button"> that
    // owns the region it controls.
    it('is operable from the keyboard: a focusable native button controlling the evidence region', () => {
        render(<AnswerEvidenceDisclosure evidence={EVIDENCE} />);
        const toggle = screen.getByRole('button', { name: /Evidence/ });

        toggle.focus();
        expect(toggle).toHaveFocus();
        expect(toggle.tagName).toBe('BUTTON');
        expect(toggle).toHaveAttribute('type', 'button');
        expect(toggle).not.toHaveAttribute('tabindex', '-1');

        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-controls')).toBe(screen.getByRole('list', { name: 'Evidence' }).id);
    });

    it('renders nothing for an answer that read no receipts', () => {
        const { container } = render(<AnswerEvidenceDisclosure evidence={[]} />);

        expect(container).toBeEmptyDOMElement();
    });
});
