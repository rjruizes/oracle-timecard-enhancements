# Design: "Last 12 Months" Tab in Previous Timecard Modal

**Date:** 2026-05-05  
**Status:** Approved

---

## Overview

Add a "Last 12 Months" tab to the existing Previous Timecard modal. The new tab shows hours aggregated by calendar month across the past 12 months (oldest → newest), with one column per month. The existing "Previous vs Current" tab is unchanged.

---

## UI Structure

### Tabs

The modal dialog gains a two-tab header immediately below the title bar:

- **Previous vs Current** — default active tab; existing table unchanged
- **Last 12 Months** — new tab; loads lazily on first click

Tab styling: active tab has a bottom border indicator matching the existing modal header color (`#3c4a5c`). Inactive tab is muted gray.

### Modal Width

The modal expands to `95vw` (up from `90vw max 1000px`) when the "Last 12 Months" tab is active, to accommodate 14 columns. The "Previous vs Current" tab retains the existing width.

### Loading State

When the user first clicks "Last 12 Months," the tab body shows:

```
Fetching historical data… 8 / 24
[=========>                    ]
This may take a few seconds
```

A progress bar updates as each pay period is fetched (~24 total, walking backwards from current).

### Loaded Table

Columns (left → right):

| Column | Notes |
|--------|-------|
| Project | Sticky on horizontal scroll, left-aligned |
| Task | Sticky on horizontal scroll, left-aligned |
| Jun '24 … Apr '25 | 11 historical months, blue-tinted header |
| May '25 (current) | Most recent month, green-tinted header |

- **Column header format:** `MMM 'YY` (e.g., `Jun '24`, `May '25`)
- **Current month** (rightmost): green background highlight
- **Empty months** (no entries): display `—`
- **Total row** at the bottom, bold, dark top border
- **Horizontal scroll** available; Project and Task columns are sticky (`position: sticky`)
- **Alternating row colors** matching existing modal style

---

## Data / Fetch Logic

### Source

Uses the same Oracle TimeCardEntryDetails REST API as the existing "Previous vs Current" fetch. No new endpoint needed.

### Strategy: Sequential chain walking (Approach A)

Starting from the current timecard's period, walk backwards one pay period at a time (~24 sequential fetches to cover 12 months). Each API response provides enough context to compute the previous period's URL, matching the existing `fetchPreviousTimecardFromPage` pattern.

### Trigger

Fetch begins only when the user clicks the "Last 12 Months" tab for the first time (lazy). If the tab has already been loaded in the current modal session, the cached result is shown immediately (no re-fetch).

### Aggregation

- Each pay period response is parsed using the existing `parseTotalsMap()` logic.
- Pay periods are bucketed by calendar month (`YYYY-MM` extracted from `StartDate`).
- If a pay period spans two calendar months, it is assigned to the month containing its `StartDate`.
- Hours for the same project/task within the same month are summed.
- The 12 months shown are: the current (possibly in-progress) calendar month as month 12, plus the 11 preceding complete calendar months.

### Error Handling

If any individual fetch fails mid-chain, stop fetching, show the months successfully retrieved so far, and display an inline warning: `"Could not load all 12 months — showing N months retrieved."`

---

## Implementation Scope

### Files to modify

| File | Change |
|------|--------|
| `src/enhancements/previous-timecard.js` | Add tab UI, loading state, 12-month table rendering, aggregation logic, wider modal width for new tab |
| `popup.js` | Expose a chainable fetch helper (or reuse existing pattern) for walking back N pay periods |

### Files unchanged

- `popup.html` — trigger button unchanged
- `src/content-main.js` — message routing unchanged
- `src/manager.js` — no new enhancement class needed

---

## Out of Scope

- Custom date range picker
- Export / download of 12-month data
- Showing individual pay period columns (only calendar month aggregation)
- Any changes to the "Previous vs Current" tab behavior
