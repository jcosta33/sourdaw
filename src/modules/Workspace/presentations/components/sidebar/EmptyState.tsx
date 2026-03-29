import { type ReactElement } from 'react';

type EmptyStateProps = {
    message: string;
};

export const EmptyState = ({ message }: EmptyStateProps): ReactElement => (
    <div className="flex flex-col items-center justify-center py-10 opacity-60">
        <span className="text-xs text-muted-foreground">{message}</span>
    </div>
);
