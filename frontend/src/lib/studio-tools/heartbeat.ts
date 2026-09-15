// Shared by browser capture and server upload. Serial renewals avoid overlaps;
// cleanup waits for in-flight renewal before acknowledgement or error handling.
export function startHeartbeat(
  renew: () => Promise<unknown>,
  intervalMs = 10_000,
) {
  let pending: Promise<void> | undefined;
  let failure: unknown;
  const timer = setInterval(() => {
    if (pending || failure) return;
    pending = renew()
      .then(
        () => {},
        (error) => {
          failure = error;
        },
      )
      .finally(() => {
        pending = undefined;
      });
  }, intervalMs);
  return async () => {
    clearInterval(timer);
    await pending;
    if (failure) throw failure;
  };
}
