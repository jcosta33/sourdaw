import { type HTMLAttributes, type ReactElement } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawControlStripProps = HTMLAttributes<HTMLDivElement>;

export const DawControlStrip = ({ className, children, ...props }: DawControlStripProps): ReactElement => (
    <Row gap={2} shrink={false} className={cn('daw-control-strip px-2 py-1', className)} {...props}>
        {children}
    </Row>
);
