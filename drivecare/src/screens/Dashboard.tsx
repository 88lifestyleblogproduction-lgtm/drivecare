import { useMemo, type ReactNode } from 'react';
import { Badge, Banner, Button, Card, Hero, IconButton, List, Page, Row, Section, Stat } from '../components/ui';
import { IconCalendar, IconFuel, IconGear, IconMap, IconRoute, IconTreatment } from '../components/Icons';
import { useData } from '../lib/data';
import ThemeToggle from '../components/ThemeToggle';
import { useNav } from '../lib/nav';
import { computeFuelStats } from '../lib/fuel';
import { buildTreatmentReport, clinicInfo, isActiveAppt } from '../lib/report';
import { categoryById } from '../lib/settings';
import { effectiveClientId } from '../lib/settings';
import { dateKey, fmtDateShort, fmtKey, fmtMonth, fmtTime, monthEndKey, monthKey, monthStartKey, thisMonthKey } from '../lib/time';
import { fmtCAD, fmtKm, fmtLitres, fmtPerKm } from '../lib/format';
import { effectiveKm, SOURCE_SHORT } from '../lib/trips';
import { formatAddress, googleMapsUrl } from '../lib/address';

export default function Dashboard() {
  const { fuel, trips, appointments, locations, settings, loaded, error } = useData();
  const nav = useNav();
  const month = thisMonthKey();
  const fuelStats = useMemo(() => computeFuelStats(fuel), [fuel]);
  const locMap = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  const monthTrips = trips.filter((t) => !t.recording && monthKey(t.startTime) === month);
  const monthKm = monthTrips.reduce((s, t) => s + (effectiveKm(t) ?? 0), 0);
  const tripsMissingKm = monthTrips.filter((t) => effectiveKm(t) == null).length;
  const monthFuel = fuelStats.monthly.find((m) => m.month === month);

  const treat = useMemo(
    () =>
      buildTreatmentReport(
        { startKey: monthStartKey(month), endKey: monthEndKey(month), categoryId: 'all', locationId: 'all' },
        appointments,
        trips,
        locations,
        settings,
        fuelStats.costPerKm
      ),
    [appointments, trips, locations, settings, fuelStats.costPerKm, month]
  );

  const now = new Date().toISOString();
  const upcoming = appointments.filter((a) => isActiveAppt(a) && a.end > now).sort((a, b) => a.start.localeCompare(b.start))[0];
  const upInfo = upcoming ? clinicInfo(upcoming, locMap) : null;
  const upLoc = upcoming?.locationId ? locMap.get(upcoming.locationId) : undefined;
  const mapsQuery = upLoc ? [upLoc.name, formatAddress(upLoc)].filter(Boolean).join(', ') : upcoming?.locationRaw ?? '';

  const recentTrips = trips
    .filter((t) => !t.recording)
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
    .slice(0, 3);
  const recentFuel = [...fuel].sort((a, b) => b.datetime.localeCompare(a.datetime)).slice(0, 3);

  const hasData = fuel.length + trips.length + appointments.length > 0;
  const backupDue = hasData && (!settings.lastBackupAt || Date.now() - new Date(settings.lastBackupAt).getTime() > 30 * 864e5);
  const setupSteps = [
    { done: !!settings.homeLocationId || locations.some((l) => l.kind === 'home'), label: 'Add your home address', go: () => (nav.setTab('treatments'), nav.setTreatmentView('clinics')) },
    { done: !!effectiveClientId(settings) && settings.selectedCalendars.length > 0, label: 'Connect Google Calendar', go: nav.openSettings },
    { done: fuel.length > 0, label: 'Log a fuel purchase', go: () => nav.setTab('fuel') },
  ];

  return (
    <Page
      title="DriveCare"
      subtitle={fmtKey(dateKey(now))}
      right={
        <>
          <ThemeToggle />
          <IconButton label="Settings" onClick={nav.openSettings}>
            <IconGear />
          </IconButton>
        </>
      }
    >
      {error && <Banner tone="error" title="Storage problem">{error}</Banner>}
      <Hero>
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold tracking-wide uppercase opacity-85">{fmtMonth(month)}</span>
          <span className="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold backdrop-blur">
            {fuelStats.costPerKm.value != null ? `${fmtPerKm(fuelStats.costPerKm.value)} · ${fuelStats.costPerKm.basis === 'verified' ? 'verified' : 'estimate'}` : 'Cost/km unavailable'}
          </span>
        </div>
        <button type="button" className="mt-3 block text-left" onClick={() => nav.setTab('trips')}>
          <div className="text-[44px] leading-none font-extrabold tracking-tight tabular">
            {monthKm.toFixed(1)}
            <span className="ml-1.5 text-[20px] font-semibold opacity-80">km</span>
          </div>
          <div className="mt-1 text-[13px] opacity-85">
            driven this month · {monthTrips.length} trip{monthTrips.length === 1 ? '' : 's'}
            {tripsMissingKm ? ` · ${tripsMissingKm} without distance` : ''}
          </div>
        </button>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => nav.setTab('fuel')} className="rounded-2xl bg-white/15 px-3 py-2.5 text-left backdrop-blur active:bg-white/25">
            <div className="text-[12px] opacity-85">Fuel spending</div>
            <div className="text-[20px] font-bold tabular">{fmtCAD(monthFuel?.spent ?? 0)}</div>
          </button>
          <button type="button" onClick={() => nav.setTab('fuel')} className="rounded-2xl bg-white/15 px-3 py-2.5 text-left backdrop-blur active:bg-white/25">
            <div className="text-[12px] opacity-85">Litres</div>
            <div className="text-[20px] font-bold tabular">{fmtLitres(monthFuel?.litres ?? 0)}</div>
          </button>
        </div>
      </Hero>

      <div className="grid grid-cols-2 gap-3">
        <Stat
          icon={<IconTreatment size={16} />}
          tone="teal"
          label="Appointment km"
          value={fmtKm(treat.totals.totalKm)}
          sub={`${treat.totals.trips} linked trip${treat.totals.trips === 1 ? '' : 's'}`}
          onClick={() => nav.setTab('reports')}
        />
        <Stat
          icon={<IconCalendar size={16} />}
          tone="purple"
          label="Appointments"
          value={String(treat.totals.appointments)}
          sub={treat.totals.estCost != null ? `Est. fuel ${fmtCAD(treat.totals.estCost)}` : 'Fuel cost unavailable'}
          onClick={() => nav.setTab('treatments')}
        />
      </div>

      {upcoming && upInfo && (
        <Section title="Next appointment">
          <Card className="relative overflow-hidden p-4">
            <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: categoryById(settings, upcoming.categoryId)?.color ?? '#0a84ff' }} />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Badge color={categoryById(settings, upcoming.categoryId)?.color}>{categoryById(settings, upcoming.categoryId)?.label ?? 'Treatment'}</Badge>
                <div className="mt-1.5 text-[19px] leading-snug font-semibold">{upInfo.name}</div>
                <div className="text-[15px] text-muted">
                  {fmtDateShort(upcoming.start)} · {upcoming.allDay ? 'All day' : `${fmtTime(upcoming.start)}–${fmtTime(upcoming.end)}`}
                </div>
                <div className="mt-1 text-[14px] leading-snug">{upInfo.address}</div>
                {!upInfo.confirmed && <div className="mt-0.5 text-[12px] text-warn">Address from calendar, not yet confirmed</div>}
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              {mapsQuery && (
                <a href={googleMapsUrl(mapsQuery)} target="_blank" rel="noopener" className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2.5 text-[15px] font-semibold text-white">
                  <IconMap size={18} /> Open in Google Maps
                </a>
              )}
              <Button variant="secondary" small onClick={() => nav.openRouteFor(dateKey(upcoming.start))}>
                Day route
              </Button>
            </div>
          </Card>
        </Section>
      )}

      {loaded && setupSteps.some((s) => !s.done) && (
        <Section title="Get started">
          <List>
            {setupSteps.map((s) => (
              <Row key={s.label} title={<span className={s.done ? 'text-muted line-through' : ''}>{s.label}</span>} left={s.done ? <Badge tone="green">Done</Badge> : <Badge tone="blue">To do</Badge>} onClick={s.done ? undefined : s.go} />
            ))}
          </List>
        </Section>
      )}
      {backupDue && (
        <Banner tone="warn" title="Back up your data">
          Records are stored only on this iPhone. Deleting Safari data or removing the app erases them.
          <div className="mt-2">
            <Button small onClick={nav.openSettings}>
              Back up now
            </Button>
          </div>
        </Banner>
      )}

      <Section title="Recent trips" action={<Button small variant="plain" onClick={() => nav.setTab('trips')}>See all</Button>}>
        {recentTrips.length ? (
          <List>
            {recentTrips.map((t) => (
              <Row
                key={t.id}
                title={`${t.start.label || 'Start'} → ${t.end.label || 'Destination'}`}
                subtitle={`${fmtDateShort(t.startTime)} · ${fmtTime(t.startTime)}${t.distanceSource ? ` · ${SOURCE_SHORT[t.distanceSource]}` : ''}`}
                detail={fmtKm(effectiveKm(t))}
                left={<RowIcon color="#0a84ff"><IconRoute size={16} /></RowIcon>}
              />
            ))}
          </List>
        ) : (
          <Card className="px-4 py-3 text-[14px] text-muted">No trips yet.</Card>
        )}
      </Section>

      <Section title="Recent fuel purchases" action={<Button small variant="plain" onClick={() => nav.setTab('fuel')}>See all</Button>}>
        {recentFuel.length ? (
          <List>
            {recentFuel.map((e) => (
              <Row key={e.id} title={e.station || 'Fuel purchase'} subtitle={`${fmtDateShort(e.datetime)} · ${fmtLitres(e.litres)}${e.fullTank ? ' · full' : ' · partial'}`} detail={fmtCAD(e.total)} left={<RowIcon color="#ff9f0a"><IconFuel size={16} /></RowIcon>} />
            ))}
          </List>
        ) : (
          <Card className="px-4 py-3 text-[14px] text-muted">No fuel purchases yet.</Card>
        )}
      </Section>
    </Page>
  );
}

function RowIcon({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-[10px] text-white" style={{ background: color }}>
      {children}
    </span>
  );
}
