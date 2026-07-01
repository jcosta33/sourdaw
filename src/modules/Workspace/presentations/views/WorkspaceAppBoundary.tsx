import { type ReactElement, type ReactNode } from 'react';

import { ErrorBoundary } from '../components/ErrorBoundary';

type WorkspaceAppBoundaryProps = {
    children: ReactNode;
};

export const WorkspaceAppBoundary = ({ children }: WorkspaceAppBoundaryProps): ReactElement => {
    return <ErrorBoundary>{children}</ErrorBoundary>;
};
