import fs from "node:fs";
import crypto from "node:crypto";

const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
const calendarId = process.env.GOOGLE_CALENDAR_ID;

if (!keyPath) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_FILE is required");
if (!calendarId) throw new Error("GOOGLE_CALENDAR_ID is required");

const credentials = JSON.parse(fs.readFileSync(keyPath, "utf8"));

const base64url = (input) =>
  Buffer.from(typeof input === "string" ? input : JSON.stringify(input))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const now = Math.floor(Date.now() / 1000);

const header = {
  alg: "RS256",
  typ: "JWT",
};

const claim = {
  iss: credentials.client_email,
  scope: "https://www.googleapis.com/auth/calendar.readonly",
  aud: "https://oauth2.googleapis.com/token",
  iat: now,
  exp: now + 3600,
};

const unsignedJwt =
  `${base64url(header)}.${base64url(claim)}`;

const signature = crypto
  .sign("RSA-SHA256", Buffer.from(unsignedJwt), credentials.private_key)
  .toString("base64")
  .replace(/=/g, "")
  .replace(/\+/g, "-")
  .replace(/\//g, "_");

const assertion = `${unsignedJwt}.${signature}`;

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  }),
});

if (!tokenResponse.ok) {
  throw new Error(
    `Token request failed: ${tokenResponse.status} ${await tokenResponse.text()}`
  );
}

const tokenJson = await tokenResponse.json();
const accessToken = tokenJson.access_token;

const start = new Date();
const end = new Date();
end.setDate(end.getDate() + 14);

const url = new URL(
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
);

url.searchParams.set("timeMin", start.toISOString());
url.searchParams.set("timeMax", end.toISOString());
url.searchParams.set("singleEvents", "true");
url.searchParams.set("orderBy", "startTime");
url.searchParams.set("maxResults", "20");

const eventsResponse = await fetch(url, {
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});

if (!eventsResponse.ok) {
  throw new Error(
    `Calendar request failed: ${eventsResponse.status} ${await eventsResponse.text()}`
  );
}

const data = await eventsResponse.json();
const events = data.items ?? [];

console.log(`Service account: ${credentials.client_email}`);
console.log(`Calendar: ${calendarId}`);
console.log(`Found ${events.length} events\n`);

for (const event of events) {
  const when = event.start?.dateTime ?? event.start?.date ?? "(no time)";
  console.log(`${when}  ${event.summary ?? "(untitled)"}`);
}
