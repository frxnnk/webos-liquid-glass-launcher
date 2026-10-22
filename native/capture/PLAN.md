# Capture lifetime implementation plan

Goal: reproduce and fix the local upstream buffer-lifetime race without TV execution.

Architecture: compile the real upstream capture loop against a fake backend. Keep the
upstream snapshot immutable and produce a separately applicable minimal patch only
after observing the failing test. The fake backend replaces unavailable LG hardware;
it does not model the proprietary driver's internal locks or prove the TV incident's cause.

1. Pin the 00c932f source snapshot and MIT license. Build a barrier-based C harness
   that observes invalidation of a buffer during the real callback/release lifetime.
2. Observe RED against the unchanged loop. Do not create the production patch first.
3. Serialize backend wait/lifecycle/frame ownership without holding the state mutex
   during hardware wait or callback, and test restart and shutdown explicitly.
4. Produce an applicable patch, hashes, bounded runner and review notes. No TV actions,
   configuration changes, new quirks, installations or external Git operations.
