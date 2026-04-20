import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { TransportSegmentedReadout } from '../TransportSegmentedReadout';

describe('TransportSegmentedReadout', () => {
    it('should invoke onClick and expose segments', () => {
        const onClick = vi.fn();
        render(
            <TransportSegmentedReadout
                label="Pos"
                segments={['01', '23', '45']}
                separators={['-', ':']}
                onClick={onClick}
                ariaLabel="Playhead position"
            />
        );
        expect(screen.getByText('01')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Playhead position' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
