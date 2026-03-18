import { type ReactElement } from 'react';
import { Mic } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';

export const VoiceButton = (): ReactElement => {
    const handleClick = () => {
        document.dispatchEvent(new CustomEvent('webdaw:toggle-voice-command'));
    };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Voice command (hold V)" onClick={handleClick}>
                    <Mic className="size-3.5" aria-hidden="true" />
                </Button>
            </TooltipTrigger>
            <TooltipContent>Voice command (hold V)</TooltipContent>
        </Tooltip>
    );
};
