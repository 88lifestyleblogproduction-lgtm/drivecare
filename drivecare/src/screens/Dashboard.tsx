import { useMemo } from 'react';
import { Badge, BasisBadge, Banner, Button, Card, IconButton, List, Page, Row, Section, Stat } from '../components/ui';
import { IconGear, IconMap } from '../components/Icons';
import { useData } from '../lib/data';
import { useNav } from '../lib/nav';
import { computeFuelStats } from '../lib/fuel';
import { buildTreatmentReport, clinicInfo, isActiveAppt } from '../lib/report';
import { categoryById } from '../lib/settings';
import { effectiveClientId } from '../lib/settings';
import { dateKey, fmtDateShort, fmtKey, fmtTime, monthEndKey, monthKey, monthStartKey, thisMonthKey } from '../lib/time';
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
        <IconButton label="Settings" onClick={nav.openSettings}>
          <IconGear />
        </IconButton>
      }
    >
      {error && <Banner tone="error" title="Storage problem">{error}</Banner>}
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

      {upcoming && upInfo && (
        <Section title="Next appointment">
          <Card className="p-4">
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

      <Section title="This month">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Kilometres driven" value={fmtKm(monthKm)} sub={`${monthTrips.length} trips${tripsMissingKm ? ` · ${tripsMissingKm} without distance` : ''}`} onClick={() => nav.setTab('trips')} />
          <Stat label="Fuel spending" value={fmtCAD(monthFuel?.spent ?? 0)} sub={`${monthFuel?.count ?? 0} purchases · ${fmtLitres(monthFuel?.litres ?? 0)}`} onClick={() => nav.setTab('fuel')} />
          <Stat label="Treatment km" value={fmtKm(treat.totals.totalKm)} sub={`${treat.totals.trips} linked trips`} onClick={() => nav.setTab('reports')} />
          <Stat
            label="Appointments"
            value={String(treat.totals.appointments)}
            sub={treat.totals.estCost != null ? `Est. fuel ${fmtCAD(treat.totals.estCost)}` : 'Fuel cost unavailable'}
            onClick={() => nav.setTab('treatments')}
          />
        </div>
        <Card className="mt-3 flex items-center justify-between px-4 py-3">
          <div>
            <div className="text-[13px] text-muted">Average fuel cost per km</div>
            <div className="text-[19px] font-bold tabular">{fmtPerKm(fuelStats.costPerKm.value)}</div>
          </div>
          <BasisBadge basis={fuelStats.costPerKm.basis} />
        </Card>
      </Section>

      <Section title="Recent trips" action={<Button small variant="plain" onClick={() => nav.setTab('trips')}>See all</Button>}>
        {recentTrips.length ? (
          <List>
            {recentTrips.map((t) => (
              <Row
                key={t.id}
                title={`${t.start.label || 'Start'} → ${t.end.label || 'Destination'}`}
                subtitle={`${fmtDateShort(t.startTime)} · ${fmtTime(t.startTime)}${t.distanceSource ? ` · ${SOURCE_SHORT[t.distanceSource]}` : ''}`}
                detail={fmtKm(effectiveKm(t))}
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
              <Row key={e.id} title={e.station || 'Fuel purchase'} subtitle={`${fmtDateShort(e.datetime)} · ${fmtLitres(e.litres)}${e.fullTank ? ' · full' : ' · partial'}`} detail={fmtCAD(e.total)} />
            ))}
          </List>
        ) : (
          <Card className="px-4 py-3 text-[14px] text-muted">No fuel purchases yet.</Card>
        )}
      </Section>
    </Page>
  );
}
