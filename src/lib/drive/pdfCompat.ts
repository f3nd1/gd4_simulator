// Runtime polyfills for pdfjs v6 on engines that lack two modern Web APIs it
// depends on — notably Safari/WebKit, which throws
//   "undefined is not a function (near '...value of readableStream...')"
// when pdfjs async-iterates a ReadableStream, and is missing
// Promise.withResolvers on older versions. The pdfjs "legacy" build only
// down-levels SYNTAX, not these runtime APIs, so transpiling alone doesn't
// help — the APIs themselves have to exist.
//
// Imported from BOTH the main thread (driveClient) and the worker wrapper
// (pdfWorker.ts), because the actual PDF parsing runs in the worker context,
// which has its own global scope that a main-thread polyfill never reaches.
export {};

type PromiseWithResolversShim = {
  withResolvers?: <T>() => { promise: Promise<T>; resolve: (v: T | PromiseLike<T>) => void; reject: (e?: unknown) => void };
};

const P = Promise as unknown as PromiseWithResolversShim;
if (typeof P.withResolvers !== "function") {
  P.withResolvers = function <T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (e?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// for await (… of readableStream) — Chrome/Firefox implement
// ReadableStream[Symbol.asyncIterator]; Safari does not. Back it with the
// always-available reader so pdfjs's stream consumption works everywhere.
const RS = typeof ReadableStream !== "undefined" ? (ReadableStream as unknown as { prototype: Record<symbol, unknown> }) : undefined;
if (RS && typeof RS.prototype[Symbol.asyncIterator] !== "function") {
  RS.prototype[Symbol.asyncIterator] = function (this: ReadableStream) {
    const reader = this.getReader();
    return {
      next: () => reader.read(),
      return: (value?: unknown) => {
        reader.releaseLock();
        return Promise.resolve({ done: true, value });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
}
