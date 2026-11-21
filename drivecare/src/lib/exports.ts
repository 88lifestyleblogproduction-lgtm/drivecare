import { categoryLabel } from './settings';
import { dateKey, fmtDateTime, fmtKey, fmtTime } from './time';
import { CATEGORY_LABEL, effectiveKm, SOURCE_LABEL } from './trips';
import { LEG_LABEL, type TreatmentReport } from './report';
import { toCsv } from './files';
import type { AppSettings, FuelEntry, SavedLocation, Trip } from './types';

const km2 = (n: number | null) => (n == null ? '' : n.toFixed(1));
const money = (n: number | null) => (n == null ? '' : n.toFixed(2));

export function reportCsv(r: TreatmentReport): Blob {
  const header = [
    'Appointment date',
    'Appointment time',
    'Treatment type',
    'Clinic name',
    'Clinic address',
    'Address confirmed',
    'Trip start',
    'Trip destination',
    'Leg',
    'Distance (km)',
    'Distance measured by',
    'Estimated fuel cost (CAD)',
    ...(r.reimburseRate != null ? [`Reimbursement at $${r.reimburseRate}/km (CAD)`] : []),
  ];
  const rows: unknown[][] = r.rows.map((x) => [
    x.date,
    x.apptTime,
    x.treatment,
    x.clinicName,
    x.clinicAddress,
    x.clinicConfirmed ? 'Yes' : 'No',
    x.fromLabel,
    x.toLabel,
    LEG_LABEL[x.leg],
    km2(x.km),
    x.source,
    money(x.estCost),
    ...(r.reimburseRate != null ? [x.km != null ? (x.km * r.reimburseRate).toFixed(2) : ''] : []),
  ]);
  for (const a of r.apptsWithoutTravel) {
    rows.push([dateKey(a.start), a.allDay ? 'All day' : `${fmtTime(a.start)}–${fmtTime(a.end)}`, '', a.summary, '', '', '', '', 'No travel recorded', '', '', '']);
  }
  return toCsv(header, rows);
}

export function fuelCsv(entries: FuelEntry[]): Blob {
  const header = ['Date/time (Vancouver)', 'Station', 'Price per litre (CAD)', 'Litres', 'Total (CAD)', 'Odometer (km)', 'Tank', 'Missed previous fill', 'Receipt', 'Notes'];
  const rows = [...entries]
    .sort((a, b) => a.datetime.localeCompare(b.datetime))
    .map((e) => [
      fmtDateTime(e.datetime),
      e.station,
      e.pricePerLitre ?? '',
      e.litres ?? '',
      e.total ?? '',
      e.odometer ?? '',
      e.fullTank ? 'Full' : 'Partial',
      e.missedPrevious ? 'Yes' : 'No',
      e.hasReceipt ? 'Yes' : 'No',
      e.notes,
    ]);
  return toCsv(header, rows);
}

export function tripsCsv(trips: Trip[]): Blob {
  const header = ['Departure (Vancouver)', 'Arrival (Vancouver)', 'From', 'To', 'Category', 'Distance used (km)', 'Distance source', 'GPS km', 'Routing km', 'Manual km', 'Odometer start', 'Odometer end', 'Linked to treatment', 'Notes'];
  const rows = [...trips]
    .filter((t) => !t.recording)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((t) => [
      fmtDateTime(t.startTime),
      t.endTime ? fmtDateTime(t.endTime) : '',
      t.start.label,
      t.end.label,
      CATEGORY_LABEL[t.category],
      km2(effectiveKm(t)),
      t.distanceSource ? SOURCE_LABEL[t.distanceSource] : '',
      km2(t.gpsKm),
      km2(t.routedKm),
      km2(t.manualKm),
      t.odometerStart ?? '',
      t.odometerEnd ?? '',
      t.toAppointmentId || t.fromAppointmentId ? 'Yes' : 'No',
      t.notes,
    ]);
  return toCsv(header, rows);
}

/** Standard PDF fonts only cover Latin-1; replace anything else. */
function pdfText(s: string): string {
  return (s ?? '')
    .replace(/[→⇒]/g, '->')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '');
}

type AutoTableFn = (doc: unknown, opts: Record<string, unknown>) => unknown;

export async function reportPdf(r: TreatmentReport, settings: AppSettings, locations: SavedLocation[]): Promise<Blob> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  // jspdf-autotable exposes the function as a named and/or default export depending on version.
  const mod = autoTableMod as unknown as { autoTable?: AutoTableFn; default?: AutoTableFn };
  const rawAutoTable = mod.autoTable ?? mod.default;
  if (typeof rawAutoTable !== 'function') throw new Error('PDF table module failed to load.');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  const blue: [number, number, number] = [10, 100, 220];
  let cursorY = 0;
  const autoTable = (d: unknown, opts: Record<string, unknown>) =>
    rawAutoTable(d, {
      ...opts,
      didDrawPage: (data: { cursor?: { y: number } }) => {
        if (data.cursor) cursorY = data.cursor.y;
      },
    });
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? cursorY;

  const cat = r.filter.categoryId === 'all' ? 'All treatment types' : categoryLabel(settings, r.filter.categoryId);
  const clinic = r.filter.locationId === 'all' ? 'All clinics' : locations.find((l) => l.id === r.filter.locationId)?.name ?? 'Selected clinic';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(20, 20, 20);
  doc.text(pdfText(r.title), M, 56);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(pdfText(`Period: ${fmtKey(r.filter.startKey)} to ${fmtKey(r.filter.endKey)}   |   ${cat}   |   ${clinic}`), M, 74);
  doc.text(pdfText(`Generated ${fmtDateTime(r.generatedAt)} (Pacific Time). Distances in kilometres; amounts in Canadian dollars (CAD).`), M, 88);

  const cpk = r.costPerKm;
  const cpkText = cpk.value == null ? 'Unavailable' : `$${cpk.value.toFixed(3)}/km (${cpk.basis === 'verified' ? 'from full-tank fuel records' : 'estimate'})`;
  autoTable(doc, {
    startY: 104,
    margin: { left: M, right: M },
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: blue },
    head: [['Summary', 'Value']],
    body: [
      ['Treatment appointments', String(r.totals.appointments)],
      ['Associated driving trips', String(r.totals.trips)],
      ['Outbound kilometres (to treatment)', `${r.totals.outboundKm.toFixed(1)} km`],
      ['Between-treatment kilometres', `${r.totals.betweenKm.toFixed(1)} km`],
      ['Return kilometres', `${r.totals.returnKm.toFixed(1)} km`],
      ['Total treatment-related kilometres', `${r.totals.totalKm.toFixed(1)} km`],
      ['Fuel cost per kilometre', cpkText],
      ['Estimated fuel cost', r.totals.estCost == null ? 'Unavailable (no reliable fuel cost per km)' : `CAD $${r.totals.estCost.toFixed(2)}`],
      ...(r.reimburseRate != null && r.totals.reimbursement != null
        ? [[`Mileage reimbursement at $${r.reimburseRate}/km`, `CAD $${r.totals.reimbursement.toFixed(2)}`]]
        : []),
      ['Trips without a distance', String(r.totals.tripsMissingDistance)],
      ['Appointments with no recorded travel', String(r.apptsWithoutTravel.length)],
    ].map((row) => row.map(pdfText)),
    columnStyles: { 0: { cellWidth: 260, fontStyle: 'bold' } },
  });

  const halfW = (W - M * 2 - 20) / 2;
  const y0 = lastY() + 18;
  autoTable(doc, {
    startY: y0,
    margin: { left: M, right: W - M - halfW },
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: blue },
    head: [['By treatment type', 'Appts', 'Trips', 'km', 'Est. CAD']],
    body: r.byCategory.map((b) => [pdfText(b.label), b.appts, b.trips, b.km.toFixed(1), money(b.cost) || '-']),
  });
  const yA = lastY();
  autoTable(doc, {
    startY: y0,
    margin: { left: M + halfW + 20, right: M },
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: blue },
    head: [['By clinic / provider', 'Appts', 'Trips', 'km', 'Est. CAD']],
    body: r.byClinic.map((b) => [pdfText(b.label), b.appts, b.trips, b.km.toFixed(1), money(b.cost) || '-']),
  });
  const yB = lastY();

  autoTable(doc, {
    startY: Math.max(yA, yB) + 18,
    margin: { left: M, right: M },
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: blue },
    head: [['How distances were measured', 'Trips', 'km']],
    body: r.bySource.map((s) => [pdfText(s.source), s.trips, s.km.toFixed(1)]),
    tableWidth: halfW,
  });

  doc.addPage();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(20, 20, 20);
  doc.text('Detailed travel log', M, 50);
  autoTable(doc, {
    startY: 62,
    margin: { left: M, right: M },
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 3.5, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: blue, fontSize: 7.5 },
    head: [['Date', 'Appointment', 'Treatment', 'Clinic and address', 'From', 'To', 'Leg', 'km', 'Measured by', 'Est. CAD']],
    body: r.rows.map((x) =>
      [
        x.date,
        x.apptTime,
        x.treatment,
        `${x.clinicName}\n${x.clinicAddress}${x.clinicConfirmed ? '' : '\n(address not yet confirmed)'}`,
        x.fromLabel,
        x.toLabel,
        LEG_LABEL[x.leg],
        km2(x.km) || '-',
        x.source,
        money(x.estCost) || '-',
      ].map(pdfText)
    ),
    columnStyles: {
      0: { cellWidth: 52 },
      1: { cellWidth: 66 },
      2: { cellWidth: 70 },
      3: { cellWidth: 150 },
      6: { cellWidth: 52 },
      7: { cellWidth: 34, halign: 'right' },
      8: { cellWidth: 62 },
      9: { cellWidth: 44, halign: 'right' },
    },
    foot: [['', '', '', '', '', '', 'Total', r.totals.totalKm.toFixed(1), '', r.totals.estCost == null ? '-' : r.totals.estCost.toFixed(2)]],
    footStyles: { fillColor: [235, 235, 240], textColor: 20, fontStyle: 'bold' },
  });

  if (r.apptsWithoutTravel.length) {
    autoTable(doc, {
      startY: lastY() + 18,
      margin: { left: M, right: M },
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [120, 120, 128] },
      head: [['Appointments with no recorded travel', 'Time', 'Treatment']],
      body: r.apptsWithoutTravel.map((a) =>
        [`${fmtKey(dateKey(a.start))} - ${a.summary}`, a.allDay ? 'All day' : fmtTime(a.start), categoryLabel(settings, a.categoryId)].map(pdfText)
      ),
    });
  }

  let y = lastY() + 24;
  const notes = [
    'About this report',
    '- Each trip is listed once. A trip is attributed to the appointment it drives to; return legs are attributed to the appointment they leave.',
    '- "GPS recorded" distances were measured on the phone while the app was open. "Routing estimate" distances come from a routing service',
    '  (OpenStreetMap data) and are estimates. "Manually entered" and "Odometer" distances were entered by the user.',
    '- Estimated fuel cost = distance x fuel cost per kilometre derived from the user\'s own fuel purchase records. It is an estimate.',
    '- This report organises personal records. It does not determine whether any travel or expense is eligible for reimbursement by ICBC,',
    '  an employer or any other payer. Confirm requirements with the organisation you submit it to.',
  ];
  if (y > doc.internal.pageSize.getHeight() - 110) {
    doc.addPage();
    y = 50;
  }
  doc.setFontSize(9);
  notes.forEach((line, i) => {
    doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
    doc.setTextColor(i === 0 ? 20 : 80, i === 0 ? 20 : 80, i === 0 ? 20 : 80);
    doc.text(pdfText(line), M, y + i * 13);
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    const H = doc.internal.pageSize.getHeight();
    doc.text(pdfText(`DriveCare - ${r.title} - ${r.filter.startKey} to ${r.filter.endKey}`), M, H - 20);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 20, { align: 'right' });
  }

  return doc.output('blob');
}
