import { type ReactElement } from 'react';

import { Stack } from '#/components/layout';

type EmptyStateProps = {
    message: string;
};

export const EmptyState = ({ message }: EmptyStateProps): ReactElement => (
    <Stack align="center" justify="center" className="py-10 opacity-60">
        <span className="text-xs text-muted-foreground">{message}</span>
    </Stack>
);
