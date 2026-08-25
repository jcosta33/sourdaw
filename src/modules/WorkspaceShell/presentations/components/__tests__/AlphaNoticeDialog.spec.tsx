import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { expectExternalProjectLink } from '../../__tests__/expectExternalProjectLink';
import { AlphaNoticeDialog } from '../AlphaNoticeDialog';

describe('AlphaNoticeDialog', () => {
    it('should render welcome content when open', () => {
        const onOpenChange = vi.fn();
        render(<AlphaNoticeDialog open onOpenChange={onOpenChange} />);
        expect(screen.getByText(/Welcome to the/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Let me cook/ })).toBeInTheDocument();
    });

    it('should call onOpenChange(false) when dismissing', () => {
        const onOpenChange = vi.fn();
        render(<AlphaNoticeDialog open onOpenChange={onOpenChange} />);
        fireEvent.click(screen.getByRole('button', { name: /Let me cook/ }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('shows the alpha version label', () => {
        render(<AlphaNoticeDialog open onOpenChange={vi.fn()} />);
        expect(screen.getByText(/Alpha Version 0\.1\.0/)).toBeInTheDocument();
    });

    it('routes feedback and bug reports to GitHub', () => {
        render(<AlphaNoticeDialog open onOpenChange={vi.fn()} />);

        expectExternalProjectLink(
            screen.getByRole('link', { name: /Discussions/ }),
            'https://github.com/jcosta33/sourdaw/discussions'
        );
        expectExternalProjectLink(
            screen.getByRole('link', { name: /Report a bug/ }),
            'https://github.com/jcosta33/sourdaw/issues'
        );
    });

    it('renders the explanatory body text mentioning GitHub feedback routes', () => {
        render(<AlphaNoticeDialog open onOpenChange={vi.fn()} />);
        expect(screen.getByText(/GitHub Discussion/)).toBeInTheDocument();
        expect(screen.getByText(/GitHub Issues/)).toBeInTheDocument();
    });
});
