// Dates as the owner reads them (24 Oct: "dd/mm/yyyy format everywhere ... not the American way").
// A browser draws its own date fields in its own language's order, so Watson's are plain text:
// day/month/year and a 24-hour clock, whatever language the browser speaks.

const pad = (n: number) => String(n).padStart(2, "0");

/** "05/01/2026". */
export const asDayMonthYear = (at: Date) => `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}`;
/** "07:03". */
export const asClock = (at: Date) => `${pad(at.getHours())}:${pad(at.getMinutes())}`;

/** The moment a day ("27/10/2026", also with dots or dashes) and a time ("14:30") name, in this browser's time zone; null if either is not real. */
export function fromDayAndClock(day: string, clock: string): Date | null {
  const date = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/.exec(day);
  const time = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(clock);
  if (!date || !time) return null;
  const [d, m, y, hours, minutes] = [date[1], date[2], date[3], time[1], time[2]].map(Number);
  if (hours > 23 || minutes > 59) return null;
  const at = new Date(y, m - 1, d, hours, minutes);
  // new Date rolls 31 February into March; a real day comes back as typed.
  return at.getFullYear() === y && at.getMonth() === m - 1 && at.getDate() === d ? at : null;
}
