import { type ReactElement } from 'react';

import { Play, Square } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

type PreviewButtonProps = {
    isPlaying: boolean;
    onPlay: () => void;
    onStop: () => void;
};

export const PreviewButton = ({ isPlaying, onPlay, onStop }: PreviewButtonProps): ReactElement => (
    <Button
        variant="bare"
        size="bare"
        type="button"
        className={cn(
            'size-4 shrink-0 flex items-center justify-center rounded transition-colors',
            isPlaying ? 'text-primary hover:text-primary/80' : 'text-muted-foreground/60 hover:text-foreground'
        )}
        onClick={(event) => {
            event.stopPropagation();
            if (isPlaying) {
                onStop();
            } else {
                onPlay();
            }
        }}
        aria-label={isPlaying ? 'Stop preview' : 'Preview sound'}
    >
        {isPlaying ? <Square className="size-2.5 fill-current" /> : <Play className="size-2.5 fill-current" />}
    </Button>
);
