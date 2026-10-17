import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type TabId = 'pool' | 'accounts' | 'activity' | 'wallet';
export const TAB_IDS: TabId[] = ['pool', 'accounts', 'activity', 'wallet'];

const fromHash = (): TabId => {
  const id = location.hash.slice(1) as TabId;
  return TAB_IDS.includes(id) ? id : 'pool';
};

/**
 * 当前 tab 记在 URL hash 里(#pool / #accounts …):刷新、复制链接、浏览器后退都能回到同一个 tab,
 * 录视频时也可以直接打开某个 tab。
 */
export function useTab() {
  const [tab, setTab] = useState<TabId>(fromHash);
  useEffect(() => {
    const onHash = () => setTab(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((id: TabId) => { if (location.hash.slice(1) !== id) location.hash = id; setTab(id); }, []);
  return [tab, go] as const;
}

export interface TabDef { id: TabId; label: string; badge?: ReactNode }

/** WAI-ARIA tabs:左右方向键切换,Home/End 到首尾;只有选中的 tab 在 Tab 键顺序里。 */
export function TabBar({ tabs, active, onChange }: { tabs: TabDef[]; active: TabId; onChange: (id: TabId) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const id = tabs[(next + tabs.length) % tabs.length].id;
    onChange(id);
    refs.current[id]?.focus();
  };
  return (
    <nav className="tabs" role="tablist" aria-label="页面" onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`}
                aria-selected={active === t.id} tabIndex={active === t.id ? 0 : -1} className={active === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}{t.badge}
        </button>))}
    </nav>
  );
}

/** 不在当前 tab 的面板只隐藏、不卸载:切走再切回,填了一半的表单、已加载的更多活动都还在。 */
export function TabPanel({ id, active, children }: { id: TabId; active: TabId; children: ReactNode }) {
  return <section role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={id !== active}>{children}</section>;
}
