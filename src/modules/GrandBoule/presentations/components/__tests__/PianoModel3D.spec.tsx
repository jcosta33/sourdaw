import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PianoModel3D } from '../PianoModel3D';

describe('PianoModel3D', () => {
    it('should render', () => {
        const { container } = render(
            <PianoModel3D
                activeNotes={new Map()}
                sustainPedal={0}
                unaCorda={false}
                sostenuto={false}
                lidPosition={0.5}
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
