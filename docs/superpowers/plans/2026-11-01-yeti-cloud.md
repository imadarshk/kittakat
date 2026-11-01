# Yeti Cloud deployment plan

Goal: Run the existing Kittakat application on Yeti Cloud and serve kittakat.duckdns.org over HTTPS.

Authorization: The user requested end-to-end deployment, repository changes, server configuration, and domain linking, with implementation choices delegated to this session.

Architecture: Keep Vinext and the Cloudflare build. Add a Node build target whose cloudflare:workers binding resolves to persistent SQLite, using Node 24's built-in SQLite. One stateful app instance stores data outside generated build output. Yeti's reverse proxy terminates HTTPS.

- [ ] Add SQLite adapter tests for real account persistence, pending migrations, transaction rollback, concurrent batches, and immutable ledger triggers; verify failures before implementation.
- [ ] Implement the adapter, Node runtime binding, target-specific Vite configuration, and build/start scripts; run the full suite, typecheck, build, and local integration test.
- [ ] Push the tested changes to the repository; provision a single Node 24 environment on Yeti, deploy the repository, and verify logs and the bootstrap endpoint.
- [ ] Bind DuckDNS, configure HTTPS, verify the public page and encrypted session behavior, and document deployment, updates, and database backup.

Review focus: Data survives restart/redeploy; migrations apply once and roll back on failure; batches are atomic; database files are not served publicly; proxy origin handling preserves HTTPS cookies and same-origin checks. No existing financial data may be deleted. No paid upgrade or new credential is authorized implicitly.
