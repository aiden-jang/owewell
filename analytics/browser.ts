import { HOST, isBrowserAnalyticsEvent, type AnalyticsEvent } from './schema.js';

/** No URL, referrer, cookie, account or user content leaves through this transport. */
function canReportAnalytics(): boolean {
  if (typeof window === 'undefined' || window.location.hostname !== HOST) return false;
  const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
  return !privacy.globalPrivacyControl && privacy.doNotTrack !== '1';
}

export function reportAnalytics(event: AnalyticsEvent): void {
  if (!isBrowserAnalyticsEvent(event) || !canReportAnalytics()) return;
  try {
    void fetch('/api/analytics', {
      method: 'POST',
      credentials: 'omit',
      mode: 'same-origin',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* Offline, blocked and unavailable analytics never interrupt the app. */
  }
}
