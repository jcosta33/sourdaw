use crate::token::Token;

/// Nom offsets count tokens here, rather than the bytes in each token's spelling.
#[derive(Debug, Clone, Copy)]
pub(crate) struct TokenInput<'a>(pub(crate) &'a [Token]);

impl<'a> nom::Input for TokenInput<'a> {
    type Item = &'a Token;
    type Iter = std::slice::Iter<'a, Token>;
    type IterIndices = std::iter::Enumerate<Self::Iter>;

    fn input_len(&self) -> usize {
        self.0.len()
    }

    fn take(&self, index: usize) -> Self {
        Self(&self.0[..index])
    }

    fn take_from(&self, index: usize) -> Self {
        Self(&self.0[index..])
    }

    fn take_split(&self, index: usize) -> (Self, Self) {
        let (prefix, remainder) = self.0.split_at(index);
        (Self(remainder), Self(prefix))
    }

    fn position<P>(&self, predicate: P) -> Option<usize>
    where
        P: Fn(Self::Item) -> bool,
    {
        self.0.iter().position(predicate)
    }

    fn iter_elements(&self) -> Self::Iter {
        self.0.iter()
    }

    fn iter_indices(&self) -> Self::IterIndices {
        self.0.iter().enumerate()
    }

    fn slice_index(&self, count: usize) -> Result<usize, nom::Needed> {
        if count <= self.0.len() {
            Ok(count)
        } else {
            Err(nom::Needed::new(count - self.0.len()))
        }
    }
}
