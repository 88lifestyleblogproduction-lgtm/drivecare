const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', currencyDisplay: 'narrowSymbol' });
const num1 = new Intl.NumberFormat('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const num0 = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 });

export const fmtCAD = (n: number | null | undefined) => (n === null || n === undefined ? '—' : cad.format(n));
/** Explicit currency label, used in reports and route summaries */
export const fmtCADLong = (n: number | null | undefined) => (n === null || n === undefined ? 'Unavailable' : `CAD ${cad.format(n)}`);
export const fmtKm = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${num1.format(n)} km`);
export const fmtNum1 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : num1.format(n));
export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : num0.format(n));
export const fmtPerL = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `$${n.toFixed(3)}/L`);
export const fmtPerKm = (n: number | null | undefined) => (n === null || n === undefined ? 'Unavailable' : `$${n.toFixed(3)}/km`);
export const fmtL100 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toFixed(1)} L/100 km`);
export const fmtLitres = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toFixed(2)} L`);
