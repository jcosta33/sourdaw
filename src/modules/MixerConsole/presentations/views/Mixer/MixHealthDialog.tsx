import { type ReactElement, useState, useEffect, useRef } from 'react';

import { Loader2, Sparkles, GraduationCap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

import { DawDialogBody } from '#/components/daw/DawDialogBody';
import { DawDialogFooter } from '#/components/daw/DawDialogFooter';
import { DawDialogSection } from '#/components/daw/DawDialogSection';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '#/components/ui/dialog';
import { logger } from '#/infra/logger/appLogger';
import { mixHealthAnalysis, streamHostedModelText } from '#/modules/AiRuntime/useCases';

type MixHealthDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export const MixHealthDialog = ({ open, onOpenChange }: MixHealthDialogProps): ReactElement => {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {open ? <MixHealthDialogContent onOpenChange={onOpenChange} /> : null}
        </Dialog>
    );
};

type MixHealthDialogContentProps = {
    onOpenChange: (open: boolean) => void;
};

const MixHealthDialogContent = ({ onOpenChange }: MixHealthDialogContentProps): ReactElement => {
    const [isAnalyzing, setIsAnalyzing] = useState(true);
    const [report, setReport] = useState('');
    const reportRef = useRef('');
    const eli5ControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        const controller = new AbortController();

        const runAnalysis = async () => {
            try {
                await mixHealthAnalysis({
                    signal: controller.signal,
                    onToken: (token) => {
                        if (controller.signal.aborted) {
                            return;
                        }
                        reportRef.current += token;
                        setReport(reportRef.current);
                    },
                });
            } catch (error) {
                if (!controller.signal.aborted) {
                    logger.warn('Mix health analysis failed:', error);
                    setReport('Error generating mix health report. Make sure Cloud AI is connected.');
                }
            } finally {
                if (!controller.signal.aborted) {
                    setIsAnalyzing(false);
                }
            }
        };

        void runAnalysis();
        return () => {
            controller.abort();
            eli5ControllerRef.current?.abort();
        };
    }, []);

    const handleELI5 = async () => {
        if (isAnalyzing || !report) {
            return;
        }

        setIsAnalyzing(true);
        const controller = new AbortController();
        eli5ControllerRef.current = controller;
        const originalReport = report;
        reportRef.current = `${report}\n\n---\n\n### ELI5 Translation\n\n`;
        setReport(reportRef.current);

        try {
            const outcome = await streamHostedModelText({
                correlationId: `mix-health-eli5-${crypto.randomUUID()}`,
                messages: [
                    { role: 'system', content: 'You are a patient music teacher for beginners.' },
                    {
                        role: 'user',
                        content: `Here is a technical mix analysis:\n\n${originalReport}\n\nPlease explain this to me like I am a 5 year old beginner. Focus entirely on simple analogies.`,
                    },
                ],
                maxOutputTokens: 2_048,
                onToken: (token) => {
                    if (controller.signal.aborted) {
                        return;
                    }
                    reportRef.current += token;
                    setReport(reportRef.current);
                },
                signal: controller.signal,
            });
            if (controller.signal.aborted) {
                return;
            }
            if (outcome.status !== 'complete') {
                reportRef.current += `\n[${outcome.failure?.safeMessage ?? 'Hosted AI response incomplete.'}]`;
                setReport(reportRef.current);
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                logger.warn('ELI5 generation failed:', error);
                reportRef.current += '\n[Error generating ELI5 explanation]';
                setReport(reportRef.current);
            }
        } finally {
            if (eli5ControllerRef.current === controller) {
                eli5ControllerRef.current = null;
            }
            if (!controller.signal.aborted) {
                setIsAnalyzing(false);
            }
        }
    };

    return (
        <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0 text-foreground">
            <DialogTitle className="sr-only">AI Music Mentor: Mix Health</DialogTitle>
            <DawHeaderBand
                className="px-4 py-3"
                startSlot={<Sparkles className="size-3.5 text-[var(--color-accent-lavender)]" />}
                title="AI Music Mentor: Mix Health"
                titleClassName="text-[11px] text-foreground normal-case tracking-normal"
            />

            <DawDialogBody scrollable className="min-h-[200px] max-h-[500px] px-4 py-4 text-sm leading-relaxed">
                <DawDialogSection
                    title="Analysis"
                    detail={report ? 'Cloud mentor report' : 'Generating a fresh read on the current mix'}
                >
                    {report ? (
                        <div className="prose prose-invert prose-sm max-w-none">
                            <ReactMarkdown>{report}</ReactMarkdown>
                        </div>
                    ) : null}

                    {isAnalyzing ? (
                        <Row gap={2} className="pt-4 text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            <span>Mentor is thinking...</span>
                        </Row>
                    ) : null}
                </DawDialogSection>
            </DawDialogBody>

            <DawDialogFooter>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleELI5}
                    disabled={isAnalyzing || !report}
                    className="bg-[var(--color-accent-lavender)]/10 text-[var(--color-accent-lavender)] hover:bg-[var(--color-accent-lavender)]/20 border-[var(--color-accent-lavender)]/20"
                >
                    <GraduationCap className="size-4 mr-2" />
                    Explain Like I'm 5
                </Button>
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                    Close
                </Button>
            </DawDialogFooter>
        </DialogContent>
    );
};
