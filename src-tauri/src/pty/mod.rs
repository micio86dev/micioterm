//! PTY subsystem: one PTY per pane.
//!
//! [`SessionManager`] owns every live [`session::PtySession`], keyed by a
//! session id that the frontend generates and owns for the pane's whole
//! lifetime. Resize is authoritative from the frontend (xterm's FitAddon
//! computes cols/rows); the backend only validates and forwards.

pub mod manager;
pub mod session;

/// Clamp terminal dimensions to a valid PTY size.
///
/// xterm's FitAddon can briefly report 0 columns/rows during a layout change or
/// while a pane is hidden, and a PTY with a zero dimension is invalid. We floor
/// both axes at 1. Resize is authoritative from the frontend, so no upper bound.
pub fn clamp_dimensions(cols: u16, rows: u16) -> (u16, u16) {
    (cols.max(1), rows.max(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_floors_zero_to_one() {
        assert_eq!(clamp_dimensions(0, 0), (1, 1));
        assert_eq!(clamp_dimensions(80, 0), (80, 1));
        assert_eq!(clamp_dimensions(0, 24), (1, 24));
    }

    #[test]
    fn clamp_passes_through_valid_dimensions() {
        assert_eq!(clamp_dimensions(80, 24), (80, 24));
        assert_eq!(clamp_dimensions(200, 50), (200, 50));
    }
}
