import { type ReactElement, useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';

import { Button } from '#/components/ui/button';
import { Copy, Check } from 'lucide-react';

type QrInviteProps = {
    inviteString: string;
};

/**
 * Displays a QR code for a collaboration invite.
 * The invite string is encoded into the QR code so another peer
 * can scan it to join the session.
 */
export const QrInvite = ({ inviteString }: QrInviteProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (canvasRef.current && inviteString) {
            QRCode.toCanvas(canvasRef.current, inviteString, {
                width: 200,
                margin: 2,
                color: {
                    dark: '#ffffff',
                    light: '#00000000',
                },
            }).catch(() => {
                // QR generation failed — invite string may be too long
            });
        }
    }, [inviteString]);

    const handleCopy = () => {
        void navigator.clipboard.writeText(inviteString);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="flex flex-col items-center gap-2">
            <canvas ref={canvasRef} className="rounded" />
            <p className="text-[10px] text-muted-foreground text-center">
                Scan this QR code to join, or copy the invite text
            </p>
            <Button variant="outline" size="xs" onClick={handleCopy} className="w-full gap-1.5">
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? 'Copied' : 'Copy Invite'}
            </Button>
        </div>
    );
};
