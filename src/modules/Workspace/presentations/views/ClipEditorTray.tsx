import { type HTMLAttributes, type ReactElement } from 'react';
import { cn } from '#/utils/Styles/cn';

type ClipEditorTrayProps = HTMLAttributes<HTMLDivElement>;

export const ClipEditorTray = ({ className, children, ...props }: ClipEditorTrayProps): ReactElement => (
    <div className={cn('border-t border-border/30 bg-surface-base/40', className)} {...props}>
        {children}
    </div>
);
