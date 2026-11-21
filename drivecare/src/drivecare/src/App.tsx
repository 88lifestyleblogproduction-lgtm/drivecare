import { useEffect, useMemo, useState } from 'react';
import { cx, ToastProvider, useToast } from './components/ui';
import { IconCalendar, IconDashboard, IconFuel, IconReport, IconRoute } from './components/Icons';
import { DataProvider, useData } from './lib/data';
import { NavContext, type Nav, type Tab, type TreatmentView } from './lib/nav';
import { consumeOAuthRedirect, listCalendars } from './lib/google';
import { loadSettings, saveSettings } from './lib/settings';
import { syncCalendars } from './lib/sync';
import { recorder } from './lib/recorder';
import { todayKey } from './lib/time';
import { errMsg } from './lib/util';
import Dashboard from './screens/Dashboard';
import TripsScreen from './screens/Trips';
import FuelScreen from './screens/Fuel';
import TreatmentsScreen from './screens/Treatments';
import ReportsScreen from './screens/Reports';
import Settings from './screens/Settings';

// Must run before anything else reads the URL.
const oauthResult = typeof window !== 'undefined' ? consumeOAuthRedirect() : null;
let oauthHandled = false;

const TABS: { id: Tab; label: string; icon: typeof IconDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: IconDashboard },
  { id: 'trips', label: 'Trips', icon: IconRoute },
  { id: 'fuel', label: 'Fuel', icon: IconFuel },
  { id: 'treatments', label: 'Schedule', icon: IconCalendar },
  { id: 'reports', label: 'Reports', icon: IconReport },
];

function readSession<T extends string>(key: string, fallback: T): T {
  try {
    return (sessionStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  return (
    <ToastProvider>
      <DataProvider>
        <Shell />
      </DataProvider>
    </ToastProvider>
  );
}

function Shell() {
  const { settings, loaded } = useData();
  const toast = useToast();
  const [tab, setTabState] = useState<Tab>(() => (oauthResult ? 'treatments' : readSession<Tab>('dc.tab', 'dashboard')));
  const [treatmentView, setTreatmentView] = useState<TreatmentView>(() => readSession<TreatmentView>('dc.tview', 'appointments'));
  const [routeDate, setRouteDate] = useState(todayKey());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const setTab = (t: Tab) => {
    setTabState(t);
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    try {
      sessionStorage.setItem('dc.tab', tab);
      sessionStorage.setItem('dc.tview', treatmentView);
    } catch {
      /* ignore */
    }
  }, [tab, treatmentView]);

  const nav: Nav = useMemo(
    () => ({
      tab,
      setTab,
      openSettings: () => setSettingsOpen(true),
      treatmentView,
      setTreatmentView,
      routeDate,
      setRouteDate,
      openRouteFor: (d: string) => {
        setRouteDate(d);
        setTreatmentView('route');
        setTabState('treatments');
        window.scrollTo({ top: 0 });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, treatmentView, routeDate]
  );

  // Theme
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#000000' : '#f2f2f7'));
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme]);

  // Ask the browser not to evict our storage (best effort).
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  // Handle the return from Google sign-in.
  useEffect(() => {
    if (!oauthResult || oauthHandled) return;
    oauthHandled = true;
    (async () => {
      if (!oauthResult.ok) {
        toast(oauthResult.error, 'error');
        return;
      }
      try {
        const s = await loadSettings();
        if (oauthResult.intent === 'connect' || !s.selectedCalendars.length) {
          const cals = await listCalendars();
          await saveSettings({
            googleConnected: true,
            availableCalendars: cals.map((c) => ({ id: c.id, name: c.name })),
            selectedCalendars: s.selectedCalendars.length ? s.selectedCalendars : cals.filter((c) => c.primary).map((c) => ({ id: c.id, name: c.name })),
          });
          toast('Google Calendar connected');
          if (!s.selectedCalendars.length) {
            setSettingsOpen(true);
            toast('Choose which calendars to read, then tap Sync now', 'info');
            return;
          }
        }
        const r = await syncCalendars();
        toast(`Synced · ${r.added} new, ${r.updated} updated, ${r.cancelled} cancelled, ${r.removed} removed`);
      } catch (e) {
        toast(errMsg(e), 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the recorder's accuracy setting current
  useEffect(() => {
    recorder.maxAccuracy = settings.gpsMaxAccuracy;
  }, [settings.gpsMaxAccuracy]);

  return (
    <NavContext.Provider value={nav}>
      <main className="min-h-screen">
        {!loaded ? (
          <div className="flex min-h-screen items-center justify-center text-muted">Loading…</div>
        ) : (
          <>
            {tab === 'dashboard' && <Dashboard />}
            {tab === 'trips' && <TripsScreen />}
            {tab === 'fuel' && <FuelScreen />}
            {tab === 'treatments' && <TreatmentsScreen />}
            {tab === 'reports' && <ReportsScreen />}
          </>
        )}
      </main>
      <TabBar tab={tab} onChange={setTab} treatmentsLabel={settings.tabLabel} />
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </NavContext.Provider>
  );
}

function TabBar({ tab, onChange, treatmentsLabel }: { tab: Tab; onChange: (t: Tab) => void; treatmentsLabel: string }) {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bar backdrop-blur-xl" aria-label="Main">
      <div className="mx-auto flex max-w-2xl">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              aria-current={active ? 'page' : undefined}
              className={cx('flex flex-1 flex-col items-center gap-0.5 pt-1.5 pb-1.5 text-[10px] font-semibold', active ? 'text-accent' : 'text-muted')}
            >
              <span className={cx('flex h-8 w-14 items-center justify-center rounded-full transition-colors', active && 'bg-accent/12')}>
                <Icon size={23} />
              </span>
              <span className="max-w-[72px] truncate">{t.id === 'treatments' ? treatmentsLabel : t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
