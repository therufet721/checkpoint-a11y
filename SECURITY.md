# Security

Checkpoint A11y runs inside your CI with access to your app, and optionally to access headers and test credentials. Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab), not in public issues.

Design commitments:
- Access headers are attached only to requests to your `baseURL` origin and `access.allowedOrigins`, never to third-party origins loaded by the page.
- In local mode nothing leaves your machine or CI runner. Results are uploaded only when you set `CHECKPOINT_A11Y_TOKEN` and an API URL.
- The runner does not attempt to bypass bot protection or CAPTCHAs.
