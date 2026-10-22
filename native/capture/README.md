# Native capture lifetime experiment

This is an experimental patch candidate for the PicCap 0.5.3 capture backend.
It was compiled for ARM and installed on the reference TV with capture OFF;
the ABI/version check passed. The app's Manual API stopped capture and independently
restored six lamp baselines; Home with capture OFF reached the launcher foreground.
The owner subsequently confirmed YouTube color tracking and a normal launcher image
after Home with capture ON (0.7.9). Manual restored all six lamp baselines, but two
required a second Manual attempt; sustained stability is not established. See
[the current checkpoint](../../docs/screen-sync.md#checkpoint-079-parada-y-catálogo).
The local lifetime defect is demonstrated; the
cause of the reference TV's black-screen/kernel incident remains unisolated.

The original IPK embeds version `heads/main-0-g00c932f`. PicCap's submodule points at
`00c932f092084b234b3f619b060a98fa134c12bd`, matching this immutable LF-normalized
snapshot. Upstream source is MIT licensed; see [LICENSE](LICENSE).

## What changes

The main capture thread owns every backend call: start, wait, acquire, conversion,
callback, release and terminate. The old vsync worker could terminate/reinitialize
the driver while another thread was still consuming a borrowed driver buffer.
Removing that worker also prevents concurrent mutation of VTC's buffer fields.

The state mutex protects stop requests, status flags and FPS. It is never held
during a backend call, conversion or callback. A stop in progress blocks a new
start; a callback cannot join itself. An invalid frame never reuses a previous
callback buffer. FPS resets at start and after a completed stop, so an earlier
session's measurement cannot attest fresh frames.

`service.c` reads capture status under that mutex and destroys it after the
capture thread has joined. Existing service connection-loop/`connected` fields
are outside this patch; this does not claim to eliminate every upstream race.

## Reproduce locally

Requires Linux/POSIX threads, a C compiler, Python 3 and `patch`. No downloads,
TV access, root action or external Git command is performed by these scripts.

```sh
cd native/capture
sh run-tests.sh upstream       # expected exit 1: demonstrated lifetime failure
sh run-tests.sh                # temporary copy + exact patch + passing cases
SANITIZE=address sh run-tests.sh
SANITIZE=thread sh run-tests.sh
```

The harness compiles the real `unicapture.c`. Fake backends replace unavailable
LG hardware; converter/libyuv stubs exercise the borrowed-frame path rather than
validating real color conversion. Condition/join wrappers provide deterministic
barriers and observe actual thread ordering. They do not replace the capture loop.
`-Wno-format` applies only to the vendored translation unit because its ARM-oriented
`uint64_t` logging format differs on LP64 hosts.

Cases cover invalidation during callback, shutdown during a callback or blocked
wait, concurrent start/stop, duplicate start/stop, restart after `-99`, invalid
frames, vsync disabled, callback self-stop and stale FPS. A process alarm bounds
each case. Synthetic frame counts are not a performance benchmark.

Ten scenarios pass normally and with AddressSanitizer/UndefinedBehaviorSanitizer.
ThreadSanitizer aborted in this WSL runtime before any test with `unexpected memory
mapping`; it is not an accredited clean TSan run. See [evidence](evidence/).

## Prepare an explicit build copy

```sh
python3 native/capture/prepare-source.py /absolute/path/to/disposable/source
```

The script checks original SHA-256 values, applies `patch --fuzz=0`, checks the
resulting SHA-256 values and stamps only that build copy's version generator as
`00c932f-mipantalla-single-owner1`. A partially modified or foreign tree is rejected.
The full upstream tree, submodules and ARM toolchain are supplied separately by
the operator; they are not installed or fetched here. `manifest.json` pins the
source, patch and resulting files.

## Limits

- Stop waits for its owning thread and never frees/terminates a live buffer from
  another thread. The existing VTC polling loop can take approximately ten seconds
  when buffers stop changing; a blocked proprietary syscall has no proven bound.
- This patch does not safely cancel a kernel `D` task or claim to fix that kernel.
- Removing parallel prefetch may affect throughput. Real FPS, latency, Home,
  standby, HDMI and protected-content behavior are untested.
- No backend switch, undocumented quirk, force-capture module or configuration
  change is included. Local RED/GREEN is not authorization to activate capture.
