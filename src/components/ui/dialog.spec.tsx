import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from './dialog';

describe('Dialog', () => {
    it('should render dialog content when open', () => {
        render(
            <Dialog open>
                <DialogContent showCloseButton={false} aria-describedby={undefined}>
                    <DialogHeader>
                        <DialogTitle>Hello</DialogTitle>
                        <DialogDescription>Details here</DialogDescription>
                    </DialogHeader>
                    <p>Body</p>
                    <DialogFooter>Actions</DialogFooter>
                </DialogContent>
            </Dialog>
        );
        expect(screen.getByText('Hello')).toBeInTheDocument();
        expect(screen.getByText('Details here')).toBeInTheDocument();
        expect(screen.getByText('Body')).toBeInTheDocument();
        expect(screen.getByText('Actions')).toBeInTheDocument();
    });
});
