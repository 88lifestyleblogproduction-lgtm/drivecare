# DriveCare

A personal, mobile-first Progressive Web App (PWA) for iPhone. It tracks fuel purchases, driving trips and treatment-related travel in Vancouver, BC. It reads treatment appointments from Google Calendar, connects each day's appointments into a driving route, and produces PDF/CSV travel reports you can use to organise records for ICBC.

- No Mac, no Xcode, no App Store, no paid backend. Runs from Safari and the iPhone Home Screen.
- All records stay **on your iPhone** (IndexedDB). There is no server-side database.
- Times use **America/Vancouver**, distances use **km**, and money uses **CAD**.

---

## Contents

1. [What's in the box](#1-whats-in-the-box)
2. [Costs and third-party services](#2-costs-and-third-party-services)
3. [Deploy for free (Cloudflare Pages or Netlify)](#3-deploy-for-free)
4. [Google Cloud OAuth setup](#4-google-cloud-oauth-setup)
5. [Install on your iPhone](#5-install-on-your-iphone)
6. [Connect your Google Calendar](#6-connect-your-google-calendar)
7. [Daily use](#7-daily-use)
8. [Backup and restore](#8-backup-and-restore)
9. [How calculations work](#9-how-calculations-work)
10. [Privacy and security](#10-privacy-and-security)
11. [Known iOS limitations](#11-known-ios-limitations)
12. [Testing checklist](#12-testing-checklist)
13. [Local development (optional)](#13-local-development-optional)
14. [Project structure](#14-project-structure)

---

## 1. What's in the box

| Tab | Features |
|---|---|
| **Dashboard** | Shows kilometres, fuel spending, cost per km, treatment km and appointment count for this month. It also shows your next appointment with its clinic address and an **Open in Google Maps** button, recent trips and fuel purchases, setup steps, and a backup reminder. |
| **Trips** | **Start Trip / End Trip** records with GPS while the app is open. You can also log trips by hand and enter odometer readings. Each trip keeps its GPS, routing-estimate and manual distances separately, and you choose which one counts. The app suggests which appointment a trip belongs to, and you confirm or reject it. |
| **Fuel** | Log each purchase with date/time, station, price per litre, litres, total, odometer, full or partial tank, a "missed previous fill-up" flag, an optional receipt photo and notes. Statistics include days between fill-ups, average days per refuel, daily cost, monthly spending, average price per litre, cost per km, L/100 km and monthly kilometres. Charts show spending, fuel economy and price. Every figure is labelled **Verified** or **Estimate**. |
| **Treatments** | **Appointments** come from Google Calendar (or are added by hand) and are classified automatically. **Route** builds the treatment-to-treatment planner with a map. **Clinics** is the address book, including the calendar addresses that still need confirming. |
| **Reports** | Generates a treatment travel report for a date range, treatment type or clinic. The **PDF** has a summary and a detailed travel log; the **CSV** has the same data. Fuel and trip data can also be exported as CSV. |
| **Settings** (gear on the Dashboard) | Google Calendar connection and calendar selection, treatment keywords, routing provider, GPS accuracy, light/dark mode, backup/restore and delete-all. |

---

## 2. Costs and third-party services

**Running cost: CAD $0.** Every service below has a free option suitable for one person. None of them guarantees unlimited use.

| Service | Used for | Cost / key | Limits (check the provider's site, they can change) | What it receives |
|---|---|---|---|---|
| **Cloudflare Pages** or **Netlify** | Hosting the app files | Free tier | Far more than one person needs | Normal web requests (no personal data, because records stay on the phone) |
| **Google Calendar API** | Reading appointments | Free. You need an OAuth **Client ID** (not a secret) | Per-project quotas far above personal use | Your Google sign-in; DriveCare requests events with a minimal field list |
| **OpenStreetMap tiles** (`tile.openstreetmap.org`) | Map display | Free, no key | Light use only; no bulk downloading. **Attribution required** (shown on every map) | The map areas you view |
| **Nominatim** (`nominatim.openstreetmap.org`) | Turning a clinic address into map coordinates | Free, no key | **Max 1 request/second**, no automated bulk geocoding, attribution required. DriveCare only geocodes when you tap **Find on map**, and caches results | The address text you search |
| **OSRM demo server** (`router.project-osrm.org`), the default | Driving distances | Free, no key | A **demo** service run by volunteers: about 1 request/second, no uptime guarantee, heavy use is not allowed. Fine for one person planning a few routes a day | Only the two coordinates of each route segment |
| **openrouteservice** (optional) | Driving distances | Free account + **API key** | Standard plan: **2,000 directions/day, 40/minute** | The two coordinates of each segment |

To keep requests to a minimum, DriveCare caches routes and geocoding results on the device: 180 days for routes, 90 days for addresses. Routing calls only happen when you tap **Calculate distances** or **Estimate**. If a routing service fails, DriveCare shows **"Distance unavailable"** and lets you type the distance. It never makes up a mileage figure.

---

## 3. Deploy for free

You need a computer (Windows, Linux, Chromebook or Mac) with a web browser for the **one-time** setup. You **do not** need to install Node.js or anything else. The hosting service builds the app for you.

### Step A: Put the code on GitHub

1. Create a free account at <https://github.com>.
2. Click **+ → New repository**. Name it `drivecare`, choose **Private**, and click **Create repository**.
3. On the new repository page, click **uploading an existing file**.
4. Unzip `drivecare.zip` on your computer. Open the `drivecare` folder and drag **everything inside it** into the upload area: `src`, `public`, `index.html`, `package.json`, etc. Don't drag the folder itself. In Chrome or Edge you can drag folders. Hidden files such as `.gitignore` and `.nvmrc` are optional.
5. Click **Commit changes**.

### Step B (option 1): Cloudflare Pages (recommended)

1. Create a free account at <https://dash.cloudflare.com>.
2. Go to **Workers & Pages → Create → Pages → Connect to Git**. Authorise GitHub and pick the `drivecare` repository.
3. Build settings:
   - Framework preset: **Vite** (or "None")
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable (optional): `NODE_VERSION` = `22`
4. Click **Save and Deploy**. After about a minute you get a URL like `https://drivecare-abc.pages.dev`. **Write it down.**

### Step B (option 2): Netlify

1. Create a free account at <https://app.netlify.com>.
2. Click **Add new site → Import an existing project → GitHub** and pick `drivecare`.
3. The settings are read from `netlify.toml` (build `npm run build`, publish `dist`, Node 22). Click **Deploy**.
4. Your URL looks like `https://something.netlify.app`. You can rename it under **Site configuration → Change site name**.

Updates: if you change any file on GitHub, the site rebuilds automatically. The app picks up the new version the next time it is opened with an internet connection.

> **Security headers.** `public/_headers` sets a Content-Security-Policy and other headers on both hosts. If you ever point DriveCare at a self-hosted routing server, it must use `https://`.

---

## 4. Google Cloud OAuth setup

This lets DriveCare read your calendar. It takes about 10 minutes, once. It's free and needs no billing account.

1. Go to <https://console.cloud.google.com> and sign in with the Google account whose calendar you use.
2. **Create a project**: use the project picker at the top, then **New project**, and name it `DriveCare`.
3. **Enable the API**: go to **APIs & Services → Library**, search for **Google Calendar API**, and click **Enable**.
4. **Configure the consent screen** (called **Google Auth Platform** or **OAuth consent screen**):
   - App name `DriveCare`, with your email as the support and developer contact.
   - Audience / user type: **External**. Publishing status: leave it as **Testing**.
   - **Test users**: add **your own Gmail address**. Only test users can sign in while the app is in Testing, which is what you want.
   - **Data access / Scopes**: add `.../auth/calendar.readonly`. This step is optional because the app requests the scope itself, but it shows the scope on the consent screen.
5. **Create the OAuth client**: go to **APIs & Services → Credentials → Create credentials → OAuth client ID** (or **Clients → Create client**).
   - Application type: **Web application**
   - **Authorised JavaScript origins**: your site, e.g. `https://drivecare-abc.pages.dev` (no trailing slash)
   - **Authorised redirect URIs**: your site **with a trailing slash**, e.g. `https://drivecare-abc.pages.dev/`
   - Click **Create** and copy the **Client ID**. It ends in `.apps.googleusercontent.com`.
   - **Do not** copy or use the client secret. DriveCare doesn't need it, and it must never go into frontend code.
6. Choose one way to give DriveCare the Client ID:
   - **Easiest**: paste it into the app under **Settings → Google Calendar → OAuth Client ID → Save Client ID**.
   - **Or** add a build environment variable `VITE_GOOGLE_CLIENT_ID` in Cloudflare/Netlify and redeploy.

The redirect URI must match exactly: scheme, domain and trailing slash. The exact value is shown in the app under **Settings → Google Calendar → Authorised redirect URI**.

---

## 5. Install on your iPhone

1. Open **Safari** on your iPhone and go to your site URL.
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. **Open DriveCare from the Home Screen icon** from now on.
   On iOS, the Home Screen app has **its own storage, separate from Safari**. Records you enter in a Safari tab won't appear in the Home Screen app, and the reverse is also true. Do all setup and record-keeping inside the Home Screen app.
4. When you first tap **Start Trip** or **Use my current location**, allow location access. If you accidentally denied it, go to **iPhone Settings → Privacy & Security → Location Services → Safari Websites → While Using the App**.

---

## 6. Connect your Google Calendar

1. In DriveCare, tap the **gear** on the Dashboard, then paste your Client ID (if you didn't use the env variable) and tap **Save Client ID**.
2. Tap **Connect Google Calendar**. You are taken to Google:
   - Choose your account.
   - Google warns **"Google hasn't verified this app"**. That's expected for a personal app in Testing mode. Tap **Continue**.
   - Allow **See and download any calendar you can access** (read-only).
3. You return to DriveCare. Choose which calendars to read (your primary calendar is pre-selected), then tap **Sync now**.
4. Under **Treatments → Appointments**, matching appointments appear. Unrelated events (lunch, meetings…) are never stored.

**Re-syncing:** tap the sync button on the Treatments tab whenever you want updates. For security, Google gives a browser-only app a token that lasts about an hour and no long-lived refresh token. When the token has expired, Sync takes you through Google again; after the first approval this is usually a single tap. The sync picks up changed times, cancellations and deleted events.

**Disconnect:** go to **Settings → Google Calendar → Disconnect**. This revokes the token, and you can choose whether to delete the imported appointments. You can also remove access at <https://myaccount.google.com/permissions>.

---

## 6b. Use the same data on your phone and computer

DriveCare can keep your phone and computer in sync through a **hidden DriveCare-only folder in your own Google Drive**. The permission it uses is `drive.appdata`, which can't see your other Drive files. There is no DriveCare server.

1. In Google Cloud, go to **APIs & Services → Library**, search for **Google Drive API** and click **Enable**. This is a one-time step.
2. *(Recommended)* In Netlify, go to **Site configuration → Environment variables** and add `VITE_GOOGLE_CLIENT_ID` with your Client ID, then redeploy. New devices then work without typing the Client ID.
3. On each device, go to **Settings → Sync between devices** and turn on **Use the same data on all my devices**, then tap **Sign in with Google & sync**. Use the **same Gmail** on every device.
4. After that, the **Sync** button syncs both your calendar and your devices. While you're signed in, changes are also sent automatically a few seconds after you make them, and pulled when the app reopens.

**How merging works:** each record keeps its newest version, and deleting a record on one device deletes it on the others. Places, work schedule, appointment types and keywords are synced too. Google tokens and API keys are never uploaded. To remove the cloud copy, use **Settings → Sync between devices → Delete cloud copy**, or go to Google Drive → Settings → Manage apps.

## 7. Daily use

### First steps
1. Go to **Treatments → Clinics → Add home address**. Type the address, tap **Find on map** and pick the right match, or tap the map to drop the pin yourself. Then **Save**.
2. Optionally add **Work** the same way.
3. Under **Treatments → Clinics**, the **Calendar locations to confirm** list shows each distinct location text from your calendar. Tap one, check the parsed fields, add the map position, and **Save**. Every appointment with that same location text, now and in future, links to that clinic automatically. If an event has no location, open the appointment and use **Enter address**. You can also tick **Also match by title** to reuse it for appointments with the same title.

### Treatment route for a day
1. On the **Treatments → Route** tab, use the arrows or date picker to choose the day. The **Day route** button on the Dashboard or an appointment also gets you there.
2. **Start from** and **End at** default to Home. You can pick Work, a clinic, or any saved place.
3. **Stops** are the day's appointments in time order. You can **move** them up or down, **Skip** one, or **+ Add stop** for an extra place such as a pharmacy. Several appointments at the same address in a row count as one stop with a 0 km leg.
4. Tap **Calculate distances**. Each leg shows its distance and source, and the map shows the whole route. If a leg fails, it shows **Distance unavailable**, and **Enter manually** lets you type it in.
5. The total distance and **estimated fuel expense** appear at the bottom. The expense uses your fuel records' cost per km, or shows *Unavailable* if there isn't enough fuel data.
6. Tap **Save as treatment trips** to create one estimated trip per leg, linked to its appointments. If you later record an actual GPS or manual trip for the same leg and link it, the report uses the actual trip instead of the estimate.

### Distances between appointments
In **Treatments → Appointments**, a thin row between two appointments on the same day shows the driving distance from one to the next. Tap **Calculate km** to work out any legs that are still missing. Tap a distance to **adjust** it, or leave it blank to remove the adjustment. These adjustments are the same ones the route planner uses, so the two screens always agree. Adjusted legs show in orange, next to the original estimate.

### Work schedule
In **Settings → Work schedule**, choose the days you work and where those days start and end (Home or Work). New day routes on workdays use those places automatically. On a workday, the route planner also has a **Use work schedule** button.

### Recording a trip
1. Mount the phone, open DriveCare, go to **Trips** and tap **Start Trip**. Keep the app open on screen.
2. Tap **End Trip** when you arrive, then review the trip. Start and end are matched to saved places within 250 m. Confirm a suggested appointment link if one is offered.
3. If you forgot to record, use **Log a trip**. Enter the times and places, then **Estimate** the distance, type it, or enter odometer readings.

### Fuel
Tap **+** on the Fuel tab after each fill-up. Enter any two of price, litres and total; the third is calculated. Always enter the odometer. Fill to full when you can. If you forgot to log a fill-up, turn on **I missed recording a previous fill-up** for the next one.

### Reports
On the **Reports** tab, choose the dates (presets available), treatment type and clinic, then tap **PDF** or **CSV**. On iPhone the share sheet opens: choose **Save to Files**, Mail, etc.

---

## 8. Backup and restore

All data is stored only on your iPhone. **You lose it all** if you:
- delete the DriveCare Home Screen icon (iOS deletes its storage), or
- clear Safari history and website data, or
- lose or reset the phone without a backup.

**Back up** (monthly, or before any iOS update): go to **Settings → Your data → Back up data → Save to Files**, then choose **iCloud Drive**. The file is called `DriveCare-backup-YYYY-MM-DD.json`. It includes fuel, trips, appointments, clinics, route plans, settings and receipt photos. It **excludes** the Google token and the openrouteservice API key. The Dashboard reminds you if your last backup is more than 30 days old.

**Restore** (new phone or after reinstalling):
1. Install DriveCare on the Home Screen again (section 5).
2. Go to **Settings → Your data → Restore backup** and pick the `.json` file from Files.
3. This **replaces** everything on the device with the backup. Then reconnect Google Calendar (section 6).

Treat the backup file as sensitive. It contains your appointment and location history.

---

## 9. How calculations work

**Fuel**
- *Average price per litre* (verified) is total spent ÷ total litres, weighted by litres.
- *Days between purchases* uses calendar days in Vancouver time. *Average days per refuel* is the span from the first to the last purchase ÷ (purchases − 1).
- *Average daily fuel expense* (estimate) is spending from the first purchase up to, but not including, the last one, divided by the days between them. The last fill's fuel hasn't been used yet.
- *L/100 km* (verified) only uses **full-tank → full-tank** intervals where:
  - both ends have odometer readings,
  - every fill in between (including partial ones) has its litres recorded, and
  - no fill in between is marked as missed.
  
  The litres of all fills after the first full tank, up to and including the second, are divided by the odometer distance. Intervals with implausible results (under 2 or over 40 L/100 km) are shown but excluded. **Partial fills are never used on their own.**
- *Cost per km* is **verified** when it comes from those same full-tank intervals. Otherwise it is an **estimate** from the odometer span and the spending between, or **unavailable** if there isn't enough data. It is never guessed.
- *Average monthly driving* (estimate) is the odometer distance ÷ days × 30.44.

**Treatment travel**
- Each trip counts **once**. A trip to an appointment is *Outbound*. A trip from one appointment to the next is *Between treatments* and is attributed to the next appointment. A trip from an appointment to home or work is *Return*.
- For the same leg, an **actual** trip (GPS, manual or odometer) replaces the **route-planner estimate**.
- Estimated fuel cost is km × cost per km. If cost per km is unavailable, the report says **Unavailable**.
- Every row states how its distance was measured: **GPS recorded**, **Routing estimate**, **Manually entered** or **Odometer**.
- Only trips that you linked to an appointment, or that came from the route planner, count as treatment travel. DriveCare never classifies driving as medical travel on its own.

**Keyword classification** matches the event **title**. Short keywords such as `PT`, `RMT` and `Dr` must be whole words. Longer ones also match the start of a word, so `physio` matches `physiotherapy`. More specific types are checked first, so "Vestibular physio" is classed as Vestibular. You can edit keywords and add types in Settings.

**Address parsing** splits the calendar location into name, street, city, province and postal code using only the text that is there. It never invents a missing part. Incomplete addresses are flagged for you to confirm.

---

## 10. Privacy and security

- **Local-first:** records live only in the browser's IndexedDB on your phone. Nothing is sent to any DriveCare server, because there isn't one.
- **Google:** read-only scope (`calendar.readonly`). The browser-based OAuth flow uses no client secret and checks a CSRF `state` value. The token is kept in `sessionStorage` only, is removed from the address bar right away, expires after about an hour, and is never written to the database or backups. Calendar requests ask only for `id, status, summary, location, updated, start, end`. Event descriptions, attendees and other details are never downloaded. Events that don't match a treatment keyword are discarded right away.
- **Location:** GPS is used only while you're recording a trip or tap *Use my current location*. Track points are stored on the device.
- **Outside services** receive only what's listed in [section 2](#2-costs-and-third-party-services). Routing services get coordinates, not names. Geocoding gets the address text you search.
- **Hosting headers:** CSP, `X-Frame-Options: DENY`, `nosniff` and a strict referrer policy (see `public/_headers`).
- **Deleting:** you can delete individual records from each editor. **Settings → Delete all data** wipes everything on the device and revokes the Google token.

---

## 11. Known iOS limitations

These are iOS rules for web apps, not bugs, and DriveCare does not claim otherwise:

- **No background GPS.** Recording stops when the screen locks, you switch apps, or iOS suspends DriveCare. Keep the app open and on screen while recording. DriveCare asks iOS to keep the screen awake where supported. If it isn't supported, set **Settings → Display & Brightness → Auto-Lock → Never** while driving. An interrupted recording can be **resumed** or **finished**, but the gap is not measured.
- **No automatic start** with CarPlay, Bluetooth or motion detection.
- **Sync is manual** (tap Sync) because web apps cannot run in the background.
- If iOS needs space, it may clear website data for apps you haven't opened in a long time. Back up regularly.

Alternatives built in: manual trips, odometer readings, routing estimates from appointment addresses, and manual distance corrections. Each is clearly labelled.

---

## 12. Testing checklist

Run through this after the first deployment. Tick each item.

**Install and storage**
- [ ] Site loads over `https://` in Safari; **Add to Home Screen** works; the icon shows; the app opens full-screen with no Safari bars.
- [ ] Add a fuel purchase, close the app completely (swipe it away), reopen it: the purchase is still there.
- [ ] Turn on Airplane Mode and reopen the app: it loads and shows saved records.
- [ ] Dark mode: switch the iPhone appearance (or Settings → Appearance) and check that screens remain readable.

**Fuel**
- [ ] Enter price + litres only: the total is calculated. Enter all three with a mismatch: you get a warning.
- [ ] An odometer reading lower than the previous one asks for confirmation.
- [ ] Two full-tank fills with odometer readings: **Fuel economy** and **Cost per km** show **Verified**, and the values match a hand calculation.
- [ ] Only partial fills: L/100 km is **Unavailable**, and cost per km is **Estimate** or **Unavailable**.
- [ ] A receipt photo saves, appears again after reopening, and can be removed.
- [ ] Deleting a purchase removes it, and the statistics update.

**Places and Google Calendar**
- [ ] Add Home with **Find on map** (pick a result) and again with a dropped pin: the pin appears on the map.
- [ ] Connect Google Calendar: the consent screen appears, you return to DriveCare, and the calendar list loads.
- [ ] A test event titled "Physio" with a full address syncs and is classified as Physiotherapy. "Lunch" is **not** imported.
- [ ] Move the event's time in Google Calendar, then Sync: the time updates. Cancel or delete it, then Sync: it shows **Cancelled** or **Removed**.
- [ ] Confirm a calendar address: other appointments with the same location text link automatically.
- [ ] An event with a partial location (e.g. just "Kits Physio") is flagged **Confirm address**. Nothing is invented.
- [ ] **Not a treatment** excludes the appointment, and it stays excluded after the next sync.
- [ ] Wait more than 1 hour (or close and reopen the app), then tap Sync: re-authorisation works.
- [ ] Disconnect revokes access (check <https://myaccount.google.com/permissions>).

**Route planner**
- [ ] A day with 3 appointments shows Home → A → B → C → Home with per-leg distances, a total and a map.
- [ ] Reorder and skip stops: the legs and total recalculate. Add an intermediate stop.
- [ ] Two appointments at the same clinic in a row give a 0 km leg.
- [ ] With Airplane Mode on, **Calculate distances** shows "Distance unavailable", and **Enter manually** works.
- [ ] Compare one leg's distance with Google Maps directions: it should be close, though not identical.
- [ ] **Save as treatment trips** creates trips. Saving again replaces them rather than duplicating them.

**Trips**
- [ ] **Start Trip** asks for location permission; the distance increases while driving (as a passenger, or before setting off); **End Trip** opens the review.
- [ ] Lock the phone during a short recording, then reopen it: the "interrupted" banner offers Resume or Finish.
- [ ] A recorded trip that ends near a clinic before an appointment shows a **suggested match**. Confirm links it; **Not this trip** hides the suggestion.
- [ ] Manual trip: **Estimate** fills the routing distance; a manual km entry and odometer readings can each be selected under **Use for totals**.

**Reports and backup**
- [ ] Treatment report totals equal the sum of the rows. Category and clinic filters work.
- [ ] PDF opens in the share sheet, has a summary page and a travel log, shows the measurement method for each row, and includes the ICBC disclaimer.
- [ ] CSV opens in Numbers or Excel with correct columns.
- [ ] Back up to iCloud Drive. **Delete all data**. Restore: everything returns, including receipt photos.

---

## 13. Local development (optional)

You only need this if you want to change the code on your own computer. It isn't needed for deployment.

```bash
# Node.js 20.19+ or 22+
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # TypeScript checks
npm run build      # production build in dist/
```

For Google sign-in on localhost, add `http://localhost:5173` (origin) and `http://localhost:5173/` (redirect URI) to the OAuth client. GPS and Add to Home Screen need HTTPS, so test those on the deployed site.

---

## 14. Project structure

```
index.html                 App shell + iOS meta tags
public/manifest.webmanifest, public/sw.js, public/icons/   PWA install + offline shell
public/_headers            Security headers (Cloudflare Pages & Netlify)
netlify.toml               Netlify build settings
src/main.tsx, src/App.tsx  Entry, tab navigation, OAuth return handling, theme
src/index.css              Tailwind v4 + iOS-style design tokens (light/dark)
src/lib/db.ts              IndexedDB wrapper (stores: fuel, receipts, trips, appointments, locations, routePlans, settings, cache)
src/lib/fuel.ts            Fuel statistics (verified vs estimate logic)
src/lib/google.ts          OAuth 2.0 redirect flow + Calendar API (read-only)
src/lib/sync.ts            Calendar sync: classify, update, cancel, remove; clinic linking
src/lib/classify.ts        Treatment keyword matching
src/lib/address.ts         Canadian address parsing/formatting (never invents data)
src/lib/geocode.ts         Nominatim lookup (rate-limited, cached)
src/lib/routing.ts         OSRM / openrouteservice routing (rate-limited, cached)
src/lib/planner.ts         Treatment-to-treatment route planner
src/lib/recorder.ts        Foreground GPS trip recorder
src/lib/matching.ts        Trip ↔ appointment suggestions
src/lib/trips.ts           Distance sources, de-duplication, attribution
src/lib/report.ts          Treatment travel report builder
src/lib/exports.ts         PDF (jsPDF) and CSV exports
src/lib/backup.ts          Backup / restore
src/components/            UI kit, map (Leaflet), charts (SVG), place editor
src/screens/               Dashboard, Trips, Fuel, Treatments, Reports, Settings
```

**Disclaimer:** DriveCare organises personal records. It does not determine whether any travel or expense is eligible for reimbursement by ICBC or any insurer. Confirm requirements with your ICBC adjuster or representative.
