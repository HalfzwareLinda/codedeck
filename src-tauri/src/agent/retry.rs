/// Determine if an HTTP status code is retryable
pub fn is_retryable_status(status: u16) -> bool {
    matches!(status, 429 | 500 | 502 | 503 | 529)
}

/// Calculate backoff delay for retry attempt (exponential with jitter)
pub fn backoff_delay(attempt: u32) -> std::time::Duration {
    let base_ms = 1000u64 * 2u64.pow(attempt); // 1s, 2s, 4s
    let jitter_ms = base_ms / 4; // ±25% jitter range
    std::time::Duration::from_millis(base_ms + jitter_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retryable_status_codes() {
        assert!(is_retryable_status(429));
        assert!(is_retryable_status(500));
        assert!(is_retryable_status(502));
        assert!(is_retryable_status(503));
        assert!(is_retryable_status(529));
    }

    #[test]
    fn non_retryable_status_codes() {
        assert!(!is_retryable_status(200));
        assert!(!is_retryable_status(400));
        assert!(!is_retryable_status(401));
        assert!(!is_retryable_status(403));
        assert!(!is_retryable_status(404));
    }

    #[test]
    fn backoff_delay_exponential() {
        let d0 = backoff_delay(0); // 1000 + 250 = 1250ms
        let d1 = backoff_delay(1); // 2000 + 500 = 2500ms
        let d2 = backoff_delay(2); // 4000 + 1000 = 5000ms
        assert_eq!(d0.as_millis(), 1250);
        assert_eq!(d1.as_millis(), 2500);
        assert_eq!(d2.as_millis(), 5000);
    }
}
