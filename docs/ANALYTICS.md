# Analytics

owewell.aidenjang.com reports aggregate traffic and a small closed set of actions to Cloudflare
Analytics Engine's existing `aidenjang_events` dataset. No additional provider is used.

Private apps block Cloudflare's automatic URL beacon through their Content Security Policy. Their browser calls only
`/api/analytics`, with credentials omitted and no referrer. Payloads contain fixed page
categories or named actions, never URLs, query strings, fragments, room/share codes,
record/account IDs, notes, names, location or form values. GPC and Do Not Track suppress
browser events. Local development and preview hosts do not report.

The Worker checks the origin, allows at most 256 bytes, rejects extra fields and unknown
categories, and uses a separate 60/minute per-IP edge limiter. IPs are used for abuse
control, never written to the analytics dataset. Missing bindings and telemetry failures
do not break product operations. Browser counters are best effort, not unique-user or
account counts; do not present them as retention or exact billing data.

- Page categories: dashboard, group, other, shared, split.
- Action names: existing server-side product events; no additional browser actions.

Dataset columns: `index1/blob1` app, `blob2` event, `blob3` fixed page category for
`page_view`, `blob4` empty, `double1` count. Existing app-specific product events keep
their established columns. Use `SUM(_sample_interval * double1)` for sampled totals.

```sql
SELECT blob1 AS app, blob2 AS event, blob3 AS category,
       SUM(_sample_interval * double1) AS events
FROM aidenjang_events
WHERE timestamp >= NOW() - INTERVAL '7' DAY
GROUP BY app, event, category
ORDER BY app, events DESC
```

Cloudflare dashboard → Storage & databases → Analytics Engine → `aidenjang_events`
→ Studio. Filter `blob1` to `owewell`. Browser-only events remain affected by blockers
and offline use. Ordinary operational request logs remain separate; this change does
not erase historical analytics URLs.

Verify before release: schema rejects IDs/prose/unknown fields, body limits and cross-origin
requests are enforced, offline reporting does not affect the app, and a built-browser
request contains only the fixed event and no Referer or Cookie headers. Check each private app's deployed Content Security Policy blocks the external Cloudflare
beacon. The free Cloudflare plan does not offer hostname-specific injection rules;
the injected script may still appear in HTML but must not execute on private apps.
Keep automatic public-site measurements set to exclude EU visitors.
