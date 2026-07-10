// Defense-in-depth recursion bound. The engine consumes IR/roster structures that
// may originate from untrusted files (`.cat`/`.rosz`). Unbounded recursion over a
// maliciously deep tree would overflow the native call stack and crash the host
// process — a denial-of-service that bypasses the never-block guarantee. Every
// recursive walk over caller-supplied structure checks this bound and throws a
// clear, catchable Error instead, which the app boundary handles like any other
// malformed-input rejection (cf. buildSymbolTable's duplicate-id throw).
//
// Real rosters nest only a few levels (force → unit → model → upgrade), so 128 is
// far beyond any legitimate structure while still tripping long before the engine
// approaches the interpreter's stack limit.
export const MAX_DEPTH = 128;

export function assertDepth(depth: number, what: string): void {
  if (depth > MAX_DEPTH) {
    throw new Error(`${what} nesting exceeds MAX_DEPTH (${MAX_DEPTH})`);
  }
}
