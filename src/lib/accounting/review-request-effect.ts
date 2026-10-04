// Strict Mode's setup→cleanup→setup is synchronous. Don't start HTTP for an
// effect already disposed in that turn; retain normal aborts after dispatch.
export function startReviewEffect(load: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); });
  return () => controller.abort();
}
