#![forbid(unsafe_code)]

pub mod error;
pub mod limits;
pub mod xml;
pub mod zip;

pub use error::{Diagnostic, ParseError};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
