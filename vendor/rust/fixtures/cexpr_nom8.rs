use std::num::Wrapping;

use cexpr::expr::{self, EvalResult};
use cexpr::token::{Kind, Token};

fn token(kind: Kind, bytes: &[u8]) -> Token {
    Token::from((kind, bytes))
}

#[test]
fn token_precedence_keeps_multiplication_and_parentheses() {
    let tokens = vec![
        token(Kind::Literal, b"7"),
        token(Kind::Punctuation, b"+"),
        token(Kind::Literal, b"2"),
        token(Kind::Punctuation, b"*"),
        token(Kind::Punctuation, b"("),
        token(Kind::Literal, b"5"),
        token(Kind::Punctuation, b"-"),
        token(Kind::Literal, b"1"),
        token(Kind::Punctuation, b")"),
    ];
    let (rest, value) = expr::expr(&tokens).expect("numeric token expression");
    assert!(rest.is_empty());
    assert_eq!(value, EvalResult::Int(Wrapping(15)));
}

#[test]
fn partial_parse_returns_the_original_unconsumed_token_slice() {
    let tokens = vec![token(Kind::Literal, b"5"), token(Kind::Identifier, b"tail")];
    let (rest, value) = expr::expr(&tokens).expect("partial expression");
    assert_eq!(value, EvalResult::Int(Wrapping(5)));
    assert_eq!(rest.len(), 1);
    assert!(std::ptr::eq(rest.as_ptr(), tokens[1..].as_ptr()));
}

#[test]
fn unknown_identifier_preserves_the_original_error_input() {
    let tokens = vec![token(Kind::Identifier, b"unknown")];
    let Err(cexpr::nom::Err::Error(error)) = expr::expr(&tokens) else {
        panic!("unknown identifier must be a recoverable parse error");
    };
    assert!(matches!(error.error, cexpr::ErrorKind::UnknownIdentifier));
    assert!(std::ptr::eq(error.input.as_ptr(), tokens.as_ptr()));
}

#[test]
fn functional_macro_keeps_argument_order_and_remainder() {
    let tokens = vec![
        token(Kind::Identifier, b"JOIN"),
        token(Kind::Punctuation, b"("),
        token(Kind::Identifier, b"first"),
        token(Kind::Punctuation, b","),
        token(Kind::Identifier, b"second"),
        token(Kind::Punctuation, b")"),
        token(Kind::Identifier, b"first"),
    ];
    let (rest, (name, arguments)) = expr::fn_macro_declaration(&tokens).expect("macro declaration");
    assert_eq!(name, b"JOIN");
    assert_eq!(arguments, vec![&b"first"[..], &b"second"[..]]);
    assert!(std::ptr::eq(rest.as_ptr(), tokens[6..].as_ptr()));
}

#[test]
fn integer_boundary_wraps_u64_max_and_rejects_overflow() {
    let (_, value) = cexpr::literal::parse(b"18446744073709551615ULL").expect("u64 maximum");
    assert_eq!(value, EvalResult::Int(Wrapping(-1)));
    assert!(cexpr::literal::parse(b"18446744073709551616ULL").is_err());
}

#[test]
fn string_literal_keeps_unicode_and_raw_escape_bytes() {
    let (_, value) = cexpr::literal::parse(br#""A\u03A9\377""#).expect("escaped literal");
    assert_eq!(value, EvalResult::Str(vec![b'A', 0xce, 0xa9, 0xff]));
}

#[test]
fn float_exponent_and_width_keep_the_same_value() {
    let (_, value) = cexpr::literal::parse(b".25e2F").expect("float literal");
    assert_eq!(value, EvalResult::Float(25.0));
    let (_, integer_exponent) = cexpr::literal::parse(b"25e0F").expect("integer exponent");
    assert_eq!(integer_exponent, EvalResult::Float(25.0));
}

#[test]
fn complete_macro_definition_rejects_the_actual_trailing_slice() {
    let tokens = vec![
        token(Kind::Identifier, b"VALUE"),
        token(Kind::Literal, b"3"),
        token(Kind::Identifier, b"trailing"),
    ];
    let Err(cexpr::nom::Err::Error(error)) = expr::macro_definition(&tokens) else {
        panic!("trailing token must fail the full-parse obligation");
    };
    assert!(matches!(error.error, cexpr::ErrorKind::Partial));
    assert!(std::ptr::eq(error.input.as_ptr(), tokens[2..].as_ptr()));
}

#[test]
fn malformed_float_exponents_are_rejected() {
    for literal in [b".25e+".as_slice(), b".25e-", b".25e", b"25eF"] {
        assert!(
            cexpr::literal::parse(literal).is_err(),
            "invalid exponent accepted: {literal:?}"
        );
    }
}
