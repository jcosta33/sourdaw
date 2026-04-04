import { type ReactElement, useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawInlineHint } from '#/components/daw/DawInlineHint';
import { Button } from '#/components/ui/button';
import { Copy, Check, AlertTriangle } from 'lucide-react';

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
    const [tooLong, setTooLong] = useState(false);
    const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (copiedTimerRef.current !== null) {
                clearTimeout(copiedTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!canvasRef.current || !inviteString) return;
        setTooLong(false);
        QRCode.toCanvas(canvasRef.current, inviteString, {
            width: 200,
            margin: 2,
            color: {
                dark: '#ffffff',
                light: '#00000000',
            },
        }).catch(() => {
            setTooLong(true);
        });
    }, [inviteString]);

    const handleCopy = () => {
        void navigator.clipboard.writeText(inviteString);
        setCopied(true);
        if (copiedTimerRef.current !== null) {
            clearTimeout(copiedTimerRef.current);
        }
        copiedTimerRef.current = setTimeout(() => {
            setCopied(false);
            copiedTimerRef.current = null;
        }, 2000);
    };

    if (tooLong) {
        return (
            <DawEmptyState
                compact
                icon={<AlertTriangle className="size-4 text-[var(--color-state-warning)]" />}
                title="Invite too long for QR"
                description="Use Copy Invite instead."
                action={
                    <Button variant="outline" size="xs" onClick={handleCopy} className="w-full gap-1.5">
                        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                        {copied ? 'Copied' : 'Copy Invite'}
                    </Button>
                }
            />
        );
    }

    return (
        <div className="flex flex-col items-center gap-2">
            <canvas ref={canvasRef} className="rounded" />
            <DawInlineHint className="px-0 py-0 text-[10px] text-muted-foreground/70">
                Scan this QR code to join, or copy the invite text
            </DawInlineHint>
            <Button variant="outline" size="xs" onClick={handleCopy} className="w-full gap-1.5">
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? 'Copied' : 'Copy Invite'}
            </Button>
        </div>
    );
};
