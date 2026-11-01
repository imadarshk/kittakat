# Yeti production hosting

Approved by the user in chat: run Kittakat on Yeti using Node.js 24 and persistent SQLite, with a temporary deployment SSH key removed afterward. Target: https://kittakat.duckdns.org. No account upgrades or payments are authorized.

Use a native Next.js production build, keeping the existing Worker build available. Next's build resolves the Worker environment module to a Node-only adapter. Reuse the existing ledger service, migrations and integrity triggers. SQLite transactions must execute synchronously without yielding, and failed batches must roll back completely. Store the database outside application releases, with WAL, foreign keys and durable writes. Back up with SQLite's online backup API and validate a restored backup.

Use Yeti's managed process supervision and its existing network entry point where available. Verify custom-domain HTTPS, credential cookies, API behavior, restart persistence, and recovery. Leave the existing Tomcat node intact. The proposed total compute range is NPR 0.586–3.514/hour after the free trial; no paid resources beyond that proposal may be provisioned without approval.

The alternative of running Wrangler's development emulator continuously was rejected because it is a development service. Moving all hosting to Cloudflare would conflict with the requested Yeti hosting. Existing records on another live deployment require an explicit migration source; never silently copy local development records into production.
