import { getDataVersion } from '../resolve/dataManifest';

/**
 * Parse a `dataVersion` string's first three dot-separated numeric components
 * (`YYYY.MM.DD`, ignoring any trailing `.N` sub-version) into a UTC calendar
 * date. Returns `undefined` if it doesn't look like a date-shaped version.
 */
export function parseDataVersionDate(dataVersion: string): Date | undefined {
  const parts = dataVersion.split('.');
  if (parts.length < 3) return undefined;
  const [y, m, d] = parts;
  if (!/^\d+$/.test(y) || !/^\d+$/.test(m) || !/^\d+$/.test(d)) return undefined;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Purely informational data-currency check (foundations_addendum.md §2: "may
 * note that newer reference data exists beyond the license's update window.
 * Never nag, never degrade").
 *
 * `updatesUntil` gates ONLY data currency, never report generation. If the
 * installed reference data postdates the key's `updatesUntil` window, this
 * returns a single, neutral FYI line; otherwise `undefined`. Report generation
 * is completely unaffected either way — this line is never a warning, never
 * colored, never blocking.
 *
 * Comparison: the data's calendar date (UTC midnight) is compared against the
 * full `updatesUntil` timestamp. Data dated the SAME calendar day as (or before)
 * `updatesUntil` is within the window — the note only fires when the data date
 * is strictly LATER than the license's update deadline.
 */
export function dataCurrencyNote(
  updatesUntil: string,
  dataVersion: string = getDataVersion(),
): string | undefined {
  const dataDate = parseDataVersionDate(dataVersion);
  if (!dataDate) return undefined;
  const untilTime = new Date(updatesUntil).getTime();
  if (Number.isNaN(untilTime)) return undefined;

  if (dataDate.getTime() > untilTime) {
    const untilDay = updatesUntil.slice(0, 10); // YYYY-MM-DD
    return (
      `Note: newer reference data (${dataVersion}) is installed, past your ` +
      `license's data-update window (through ${untilDay}). Reports still ` +
      `generate in full — this is informational only.`
    );
  }
  return undefined;
}
