import { haversineKm, hasCoords } from './geo';
import type { Appointment, SavedLocation, Trip } from './types';

export interface MatchSuggestion {
  appointmentId: string;
  direction: 'to' | 'from';
  score: number;
  reasons: string[];
}

const NEAR_M = 400;

function activeAppt(a: Appointment) {
  return !a.excluded && a.status !== 'cancelled' && a.status !== 'removed' && !a.allDay;
}

/**
 * Suggests appointments a trip may belong to. Suggestions are never applied automatically;
 * the user confirms or rejects each one.
 */
export function suggestMatches(trip: Trip, appointments: Appointment[], locations: Map<string, SavedLocation>): MatchSuggestion[] {
  if (trip.recording || trip.origin === 'route-plan') return [];
  const tStart = new Date(trip.startTime).getTime();
  const tEnd = new Date(trip.endTime ?? trip.startTime).getTime();
  const out: MatchSuggestion[] = [];

  for (const a of appointments) {
    if (!activeAppt(a) || trip.rejectedMatches.includes(a.id)) continue;
    const aStart = new Date(a.start).getTime();
    const aEnd = new Date(a.end).getTime();
    const loc = a.locationId ? locations.get(a.locationId) : undefined;

    // Driving TO the appointment: arrive up to 2 h early or 20 min late.
    if (trip.toAppointmentId !== a.id) {
      const early = (aStart - tEnd) / 60000;
      if (early >= -20 && early <= 120) {
        const reasons = [early >= 0 ? `Arrived ${Math.round(early)} min before the appointment` : `Arrived ${Math.round(-early)} min after the start time`];
        let score = 50 - Math.abs(early) / 4;
        if (loc && hasCoords(loc) && hasCoords(trip.end)) {
          const d = haversineKm(trip.end, loc) * 1000;
          if (d <= NEAR_M) {
            score += 50;
            reasons.push('Trip ended at the clinic');
          } else {
            score -= 30;
            reasons.push(`Trip ended ${(d / 1000).toFixed(1)} km from the clinic`);
          }
        } else if (trip.end.locationId && trip.end.locationId === a.locationId) {
          score += 50;
          reasons.push('Destination is the clinic');
        } else {
          reasons.push('Location could not be compared');
        }
        if (score > 20) out.push({ appointmentId: a.id, direction: 'to', score, reasons });
      }
    }

    // Driving FROM the appointment: leave up to 20 min before the scheduled end, or up to 3 h after.
    if (trip.fromAppointmentId !== a.id) {
      const after = (tStart - aEnd) / 60000;
      if (after >= -20 && after <= 180) {
        const reasons = [after >= 0 ? `Left ${Math.round(after)} min after the appointment ended` : `Left ${Math.round(-after)} min before the scheduled end`];
        let score = 45 - Math.abs(after) / 6;
        if (loc && hasCoords(loc) && hasCoords(trip.start)) {
          const d = haversineKm(trip.start, loc) * 1000;
          if (d <= NEAR_M) {
            score += 50;
            reasons.push('Trip started at the clinic');
          } else {
            score -= 30;
            reasons.push(`Trip started ${(d / 1000).toFixed(1)} km from the clinic`);
          }
        } else if (trip.start.locationId && trip.start.locationId === a.locationId) {
          score += 50;
          reasons.push('Start is the clinic');
        } else {
          reasons.push('Location could not be compared');
        }
        if (score > 20) out.push({ appointmentId: a.id, direction: 'from', score, reasons });
      }
    }
  }

  // Best suggestion per direction (skip directions already confirmed)
  const best = (dir: 'to' | 'from') =>
    out
      .filter((s) => s.direction === dir)
      .filter(() => (dir === 'to' ? !trip.toAppointmentId : !trip.fromAppointmentId))
      .sort((a, b) => b.score - a.score)[0];
  return [best('to'), best('from')].filter((x): x is MatchSuggestion => !!x);
}

export function confidenceLabel(score: number): string {
  if (score >= 80) return 'Strong match';
  if (score >= 45) return 'Possible match';
  return 'Weak match';
}
