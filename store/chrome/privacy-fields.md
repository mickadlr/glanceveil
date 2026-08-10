# Chrome Web Store privacy fields

## Single purpose

Locally change the visual presentation of text on webpages to make casual
shoulder-surfing harder while preserving normal page interaction.

## Permission justifications

### `storage`

Stores the user's Kalima preferences, custom declarative script packs, and
explicit per-site rules locally. Temporary tab overrides use session storage
when supported. No page text or telemetry is stored.

### Host access: `<all_urls>`

Kalima's user-facing purpose applies to arbitrary webpages selected by the
user. Its content script must read eligible visible text and change its local
presentation, observe dynamic replacements, and display its local status and
input mirror. It excludes passwords, code, media, and unsupported surfaces.
Nothing read from a page is transmitted to the developer or a third party.

### Google Docs main-world script

Google Docs paints document text to canvas. A script limited to
`https://docs.google.com/document/*` wraps only relevant canvas text-drawing
calls so the selected visual mapping can be applied without changing the
document model, measured text, copy, selection, or submitted input.

## Data handling disclosure

Kalima locally handles these categories only as necessary for its visible
feature:

- Website content
- User-generated content and personal communications displayed on webpages
- Form data in supported non-password text controls when input veiling is on
- A site origin when the user explicitly saves a site rule

Kalima does not collect or transmit these categories off the user's device. It
does not handle authentication information, financial transactions, health
data, location, contacts, or browsing history for analytics or advertising.

The dashboard disclosure and [project privacy policy](../../PRIVACY.md) must
remain consistent. If the dashboard treats local processing as data handling,
select the applicable categories above and state that the data is processed
ephemerally on-device and is neither collected by nor accessible to the
developer.

## Certifications

- Data use is limited to Kalima's disclosed single purpose.
- User data is not sold or transferred to third parties outside an acquisition
  permitted by applicable policy and law.
- User data is not used for advertising, creditworthiness, or lending.
- Humans are not allowed to read user data; Kalima has no backend through which
  the developer could access it.
- The extension contains no remotely hosted executable code.
- Kalima's use of information received from Google APIs adheres to the Chrome
  Web Store User Data Policy, including the Limited Use requirements.
