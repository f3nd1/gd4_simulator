// Race a promise against a hard deadline. Exists because some browser-SDK
// promises can simply NEVER settle — Google Identity Services' token client
// only settles when its callback fires, and a failed silent re-auth (blocked
// cookies, dropped network, long-backgrounded tab) can drop that callback
// entirely. An un-deadlined await on such a promise froze a real 155-file
// audit run for 98 minutes. If the deadline fires first, the returned promise
// rejects with `new Error(timeoutMessage)`; the original promise's eventual
// settlement (if any) is then a no-op, not an unhandled rejection.
export function withDeadline<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}
