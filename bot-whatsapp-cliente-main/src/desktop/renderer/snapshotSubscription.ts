type SnapshotSubscriptionOptions<T> = {
  load: (signal: AbortSignal) => Promise<T>;
  listen?: (receive: (snapshot: T) => void, fail: () => void) => () => void;
  receive: (snapshot: T) => void;
  onError?: (error?: unknown) => void;
  intervalMs: number;
  maxSilenceMs?: number;
};

// HTTP is also a watchdog for proxies which accept SSE but stop forwarding it.
// Only one HTTP request may run at a time; a stream update supersedes older HTTP data.
export function subscribeSnapshots<T>(options: SnapshotSubscriptionOptions<T>) {
  let active = true;
  let loading = false;
  let streamRevision = 0;
  let lastStreamAt = 0;
  let streamFailed = false;
  const controller = new AbortController();

  const refresh = async () => {
    if (!active || loading) return;
    loading = true;
    const revision = streamRevision;
    try {
      const snapshot = await options.load(controller.signal);
      if (active && revision === streamRevision) options.receive(snapshot);
    } catch (error) {
      if (active) options.onError?.(error);
    } finally {
      loading = false;
    }
  };

  const stopListening = options.listen?.((snapshot) => {
    if (!active) return;
    streamRevision += 1;
    lastStreamAt = Date.now();
    streamFailed = false;
    options.receive(snapshot);
  }, () => {
    if (!active) return;
    streamFailed = true;
    options.onError?.();
    void refresh();
  });

  void refresh();
  const timer = setInterval(() => {
    if (!lastStreamAt || streamFailed || Date.now() - lastStreamAt >= (options.maxSilenceMs ?? options.intervalMs)) {
      void refresh();
    }
  }, options.intervalMs);

  return () => {
    active = false;
    clearInterval(timer);
    controller.abort();
    stopListening?.();
  };
}
