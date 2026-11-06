/**
 * The device runtimes that hold notes the audio graph's stop sweep cannot
 * reach. Each module owns its own release; Transport owns when and in which
 * order they run.
 */
type NotePanicParticipants = {
    /**
     * Settle every note a MIDI effect runtime generated, at the sample time
     * given. Transport teardown (stop, pause, seek, graph repair, scheduler
     * restart) and the full panic both call it.
     */
    settleGeneratedNotes: (sampleTime: number) => Promise<void>;
    /**
     * Releases only the full panic reaches, run one after another in this
     * order once the generated notes have settled: voices that live outside
     * the Web Audio graph.
     */
    voiceReleases: readonly (() => Promise<void>)[];
};

let registeredParticipants: NotePanicParticipants | null = null;

function releasesDiffer(current: NotePanicParticipants, next: NotePanicParticipants): boolean {
    return (
        current.voiceReleases.length !== next.voiceReleases.length ||
        current.voiceReleases.some((release, index) => release !== next.voiceReleases[index])
    );
}

/**
 * Transport may not import a device module, so the composition root
 * (`#/app/registerDeviceEnginePorts`) fills this once at boot, before anything
 * can start playback.
 */
export const notePanicParticipants = {
    /**
     * Registering the identical participants again is a no-op, so a caller
     * that cannot know whether registration already ran may repeat it.
     * Different participants refuse.
     */
    configure(participants: NotePanicParticipants): void {
        if (registeredParticipants === null) {
            registeredParticipants = { ...participants, voiceReleases: [...participants.voiceReleases] };
            return;
        }
        if (
            registeredParticipants.settleGeneratedNotes !== participants.settleGeneratedNotes ||
            releasesDiffer(registeredParticipants, participants)
        ) {
            throw new Error('notePanicParticipants.configure: the participants differ from the registered ones');
        }
    },
    /**
     * The registered participants. Reading before registration throws rather
     * than answering none: a panic that silently skipped them would leave
     * their notes hanging.
     */
    read(caller: string): NotePanicParticipants {
        if (registeredParticipants === null) {
            throw new Error(
                `${caller}: note panic participants are not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredParticipants;
    },
};
