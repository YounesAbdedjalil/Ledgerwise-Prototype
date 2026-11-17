# Email provider setup

## Brevo transactional email

1. In Brevo, open **Settings → SMTP & API → API Keys & MCP** and create an API key for Ledgerwise. Store it securely; do not commit it or expose it in browser code.
2. Register and verify a sender in Brevo. The address configured as `EMAIL_FROM` must be an approved sender. Domain authentication is recommended for deliverability and may be required by Brevo for your account.
3. Add these values to `.env.local` for local development and to the hosting provider's encrypted environment settings in deployed environments:

   ```dotenv
   BREVO_API_KEY=your_brevo_api_key
   EMAIL_FROM=hello@your-verified-sender-domain.example
   EMAIL_FROM_NAME=Ledgerwise
   # Optional: replies go to this verified/monitored address.
   EMAIL_REPLY_TO=hello@your-verified-sender-domain.example
   # Keep disabled until sender verification and controlled live-send checks are complete.
   EMAIL_LIVE_SEND_ENABLED=0
   ```

   `EMAIL_FROM` may also use the format `Ledgerwise <hello@example.com>`. If using that format, the display name in it takes precedence over `EMAIL_FROM_NAME`.
4. Restart/redeploy the app after changing environment variables. The Integrations page only checks that the required variables exist; it cannot confirm that Brevo accepts the API key or sender.
5. Create and approve a draft through the normal review flow. Simulated send remains available. Real sending requires setting `EMAIL_LIVE_SEND_ENABLED=1` and then explicitly selecting **Send real email** on an approved draft.

The application sends plain-text transactional messages through `POST https://api.brevo.com/v3/smtp/email`. A successful response means Brevo accepted the message; it does not prove inbox delivery. Check Brevo's transactional email logs for delivery outcomes. The application continues to require a human-verified recipient source, suppression check, approved draft, and content guardrail validation.

Brevo's free plan currently documents a 300-send daily limit and includes its branding. Confirm account and sender eligibility in the Brevo dashboard before enabling live sending.
