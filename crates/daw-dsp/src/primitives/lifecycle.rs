/// Processor-owned render lifecycle, modeled after CLAP's process status and tail contract.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProcessLifecycle {
    Continue,
    ContinueIfNotQuiet,
    Tail(TailLength),
    Sleep,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TailLength {
    Finite(u64),
    Infinite,
}

impl ProcessLifecycle {
    pub const CONTINUE_CODE: u32 = 0;
    pub const CONTINUE_IF_NOT_QUIET_CODE: u32 = 1;
    pub const TAIL_CODE: u32 = 2;
    pub const SLEEP_CODE: u32 = 3;

    pub fn code(self) -> u32 {
        match self {
            Self::Continue => Self::CONTINUE_CODE,
            Self::ContinueIfNotQuiet => Self::CONTINUE_IF_NOT_QUIET_CODE,
            Self::Tail(_) => Self::TAIL_CODE,
            Self::Sleep => Self::SLEEP_CODE,
        }
    }

    pub fn tail_samples(self) -> Option<TailLength> {
        match self {
            Self::Tail(length) => Some(length),
            Self::Continue | Self::ContinueIfNotQuiet | Self::Sleep => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ProcessLifecycle, TailLength};

    #[test]
    fn lifecycle_codes_are_stable_for_host_abi() {
        assert_eq!(ProcessLifecycle::Continue.code(), 0);
        assert_eq!(ProcessLifecycle::ContinueIfNotQuiet.code(), 1);
        assert_eq!(ProcessLifecycle::Tail(TailLength::Finite(64)).code(), 2);
        assert_eq!(ProcessLifecycle::Sleep.code(), 3);
    }

    #[test]
    fn tail_length_is_present_only_for_tail_state() {
        assert_eq!(
            ProcessLifecycle::Tail(TailLength::Infinite).tail_samples(),
            Some(TailLength::Infinite)
        );
        assert_eq!(ProcessLifecycle::Sleep.tail_samples(), None);
    }
}
