# Shared Google Ads MCP for Claude

This guide is for running `googleads/google-ads-mcp` as a shared remote MCP server that multiple people can add in Claude as a custom connector.

Do not use the local Codex stdio setup for this. Local stdio starts the MCP server on one laptop. Claude custom connectors need a remote HTTPS MCP endpoint that Anthropic can reach from Claude's cloud infrastructure.

## Recommended architecture

- Host the official Google Ads MCP server as a separate Cloud Run service.
- Store shared server secrets in Secret Manager and expose them to Cloud Run as environment variables.
- Use the Google Ads MCP OAuth proxy so each Claude user authenticates with their own Google account.
- Add the resulting `https://.../mcp` URL as a custom connector in Claude.

This keeps the developer token server-side, while each user only gets access to Google Ads accounts they are allowed to access through Google OAuth.

## Required Google credentials

- `GOOGLE_PROJECT_ID`: Google Cloud project ID.
- `GOOGLE_ADS_DEVELOPER_TOKEN`: Google Ads developer token.
- `GOOGLE_ADS_MCP_OAUTH_CLIENT_ID`: OAuth Web client ID.
- `GOOGLE_ADS_MCP_OAUTH_CLIENT_SECRET`: OAuth Web client secret.
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID`: optional manager account customer ID, without dashes.

In the Google Cloud OAuth client, add:

- Authorized JavaScript origin: `https://YOUR-CLOUD-RUN-URL`
- Authorized redirect URI: `https://YOUR-CLOUD-RUN-URL/auth/callback`

The OAuth app must request the Google Ads scope:

```text
https://www.googleapis.com/auth/adwords
```

If the OAuth app is in testing mode, add every Claude user as a test user. For wider external access, publish and verify the OAuth consent screen as needed by Google.

## Store secrets

Put the sensitive values in Secret Manager. These commands read from your local shell variables and avoid putting secret values directly in the command line:

```bash
export GOOGLE_ADS_DEVELOPER_TOKEN="your-developer-token"
export GOOGLE_ADS_MCP_OAUTH_CLIENT_SECRET="your-oauth-client-secret"

printf '%s' "$GOOGLE_ADS_DEVELOPER_TOKEN" \
  | gcloud secrets create google-ads-developer-token --data-file=-

printf '%s' "$GOOGLE_ADS_MCP_OAUTH_CLIENT_SECRET" \
  | gcloud secrets create google-ads-mcp-oauth-client-secret --data-file=-
```

If the secrets already exist, add new versions instead:

```bash
printf '%s' "$GOOGLE_ADS_DEVELOPER_TOKEN" \
  | gcloud secrets versions add google-ads-developer-token --data-file=-

printf '%s' "$GOOGLE_ADS_MCP_OAUTH_CLIENT_SECRET" \
  | gcloud secrets versions add google-ads-mcp-oauth-client-secret --data-file=-
```

Make sure the Cloud Run runtime service account has `roles/secretmanager.secretAccessor` on those secrets.

## Deploy to Cloud Run

Clone the official server and deploy it from that repository:

```bash
git clone https://github.com/googleads/google-ads-mcp.git
cd google-ads-mcp

gcloud config set project YOUR_PROJECT_ID

gcloud artifacts repositories create mcp-servers \
  --repository-format=docker \
  --location=us-central1

gcloud builds submit \
  --tag us-central1-docker.pkg.dev/YOUR_PROJECT_ID/mcp-servers/google-ads-mcp:latest .
```

Deploy once with a placeholder base URL. The developer token and OAuth client secret are injected from Secret Manager:

```bash
gcloud run deploy google-ads-mcp \
  --image us-central1-docker.pkg.dev/YOUR_PROJECT_ID/mcp-servers/google-ads-mcp:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="GOOGLE_PROJECT_ID=YOUR_PROJECT_ID,GOOGLE_ADS_MCP_OAUTH_CLIENT_ID=YOUR_CLIENT_ID,GOOGLE_ADS_MCP_BASE_URL=https://placeholder.example,FASTMCP_HOST=0.0.0.0" \
  --set-secrets="GOOGLE_ADS_DEVELOPER_TOKEN=google-ads-developer-token:latest,GOOGLE_ADS_MCP_OAUTH_CLIENT_SECRET=google-ads-mcp-oauth-client-secret:latest"
```

Copy the Cloud Run service URL from the deploy output, then update `GOOGLE_ADS_MCP_BASE_URL` to the real URL:

```bash
gcloud run services update google-ads-mcp \
  --region us-central1 \
  --update-env-vars="GOOGLE_ADS_MCP_BASE_URL=https://YOUR-CLOUD-RUN-URL"
```

Then update the OAuth client redirect URI in Google Cloud to:

```text
https://YOUR-CLOUD-RUN-URL/auth/callback
```

The Claude connector URL is:

```text
https://YOUR-CLOUD-RUN-URL/mcp
```

## Add in Claude

For Claude Team or Enterprise, an owner adds the connector:

```text
Organization settings -> Connectors -> Add -> Custom -> Web
```

Use the MCP server URL:

```text
https://YOUR-CLOUD-RUN-URL/mcp
```

After the owner adds it, each member connects it in Claude and completes Google OAuth. For Pro or Max, each user can add the same URL as a custom connector in their own connector settings.

## Why not Vercel for this server?

Vercel environment variables are correct for code that runs on Vercel. The official Google Ads MCP server is a Python FastMCP service with a Dockerfile and documented Cloud Run deployment path. Hosting it as a separate Cloud Run service is simpler and matches the upstream runtime.

Keep this Vercel project for the existing Gripp and GoHighLevel MCP endpoints unless you intentionally build a separate Google Ads proxy here.
