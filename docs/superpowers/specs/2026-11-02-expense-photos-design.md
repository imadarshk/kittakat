# Expense descriptions and photos

Keep the existing named, creator-only account-free members. Add an optional description (up to 4,000 characters) and up to four photos to each expense. Show a description/photo indicator in the expense list. Opening the expense and expanding its Description & photos displays the description and actual photos inline, with the original uploader's name. Interpretation: “show whose photos directly” means both display the photos directly and identify who added them.

Use the existing React forms, ledger revision model and private SQLite/D1 database. Store photo bytes separately from revision JSON so bootstrap and reports do not carry image bodies. Save new photo records, financial entry/revision and audit in the same atomic batch. Retained photos must belong to the same entry and space; metadata comes from the server. Corrections can retain, add or remove photos without deleting earlier snapshots or original image bytes. Existing expenses without these fields continue to work. Description-only changes follow existing creator-only correction and re-review rules.

The browser prepares JPEG photos, resizing to at most 1,600 pixels per side and compressing to at most 512 KiB each. Accept JPEG/PNG uploads server-side after checking base64, magic bytes, dimensions and size; never accept SVG or remote URLs. The form accepts JPEG, PNG and WebP originals up to 20 MiB each and converts them before saving. Limit incoming entry JSON to 3 MiB and other JSON to the existing 64 KiB. Photos require active space membership at a private GET endpoint and are served with no-store, nosniff and inline image content type. Uploader identity and time are server-attributed.

## Approaches and implementation decisions

Chosen: store bounded base64 photo bodies in a dedicated private table and reference their metadata from immutable payloads. This works for both existing database targets and needs no new hosting storage credentials. Each record stays below D1's [2 MB row/string limit](https://developers.cloudflare.com/d1/platform/limits/). Photos travel with database backups. One additive migration creates the photo table and append-only protections; earlier migrations are untouched.

Storing images directly in revision JSON would bloat every bootstrap and duplicate bytes on each correction. Separate filesystem/R2 storage would require new hosting configuration and complicate atomic saves; neither is needed for these bounded expense attachments.

Description and photo names are included in expense CSV/Excel reports, and history JSON includes description and photo metadata. Image binaries are accessed through the authenticated viewer, not embedded in exports. No rich HTML editor, public photo URLs, photo captions, account conversion, or photo editing tools are added.
