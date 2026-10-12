import { useEffect, useRef, useState } from 'react';

/** 轮询：刷新时保留上一次的数据(不闪烁、不跳版面)，只在 stale 时调低透明度。 */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], everyMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let alive = true;
    const run = async () => {
      setStale(true);
      try { const next = await loadRef.current(); if (alive) { setData(next); setError(null); } }
      catch (e) { if (alive) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (alive) setStale(false); }
    };
    void run();
    const timer = setInterval(run, everyMs);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, stale };
}
