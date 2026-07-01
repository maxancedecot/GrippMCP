# Gripp MCP

Model Context Protocol server for the Gripp API 3.0 endpoint at `https://api.gripp.com/public/api3.php`.

The Gripp API is JSON-RPC-like: requests are POSTed as a batch array, and the API token is sent as `Authorization: Bearer <token>`.

## Setup

```bash
npm install
npm run fetch:metadata
npm run build
```

Set your Gripp API token before starting the server:

```bash
export GRIPP_API_TOKEN="your-token"
npm start
```

Optional environment variables:

```bash
GRIPP_API_URL=https://api.gripp.com/public/api3.php
GRIPP_REQUEST_TIMEOUT_MS=30000
```

`GRIPP_API_URL` is intentionally restricted to the `https://api.gripp.com/` host.

## MCP Client Config

Example stdio config:

```json
{
  "mcpServers": {
    "gripp": {
      "command": "node",
      "args": ["/absolute/path/to/MCP Gripp/dist/src/cli.js"],
      "env": {
        "GRIPP_API_TOKEN": "your-token"
      }
    }
  }
}
```

After publishing or linking the package, you can also run the `gripp-mcp` binary.

## Vercel Remote MCP

This repo also exposes a Streamable HTTP MCP endpoint for Vercel through a Next.js route:

```text
https://your-vercel-domain.vercel.app/api/mcp
```

For Claude custom connectors, use the `/api/mcp` URL. The root URL only returns a health response.

Set this environment variable in Vercel before using Gripp tools:

```bash
GRIPP_API_TOKEN=your-token
MCP_ACCESS_KEY=long-random-secret
```

Use the access key in Claude's custom connector URL:

```text
https://your-vercel-domain.vercel.app/api/mcp?access_key=long-random-secret
```

The `/api/mcp` endpoint fails closed in production if `MCP_ACCESS_KEY` is not set. If the URL leaks, rotate `MCP_ACCESS_KEY` in Vercel and redeploy.

The remote endpoint can also read a Gripp token from `Authorization: Bearer <token>` or `x-gripp-api-token`, but Claude's custom connector UI does not currently provide a simple custom-header field. For Claude, the practical setup is to store `GRIPP_API_TOKEN` in the Vercel project environment.

## GoHighLevel Remote MCP

The same Vercel project can also host a GoHighLevel MCP endpoint with OAuth token storage:

```text
https://your-vercel-domain.vercel.app/api/ghl/mcp
```

Set these environment variables in Vercel:

```bash
GHL_CLIENT_ID=your-highlevel-client-id
GHL_CLIENT_SECRET=your-highlevel-client-secret
GHL_INSTALL_URL=your-highlevel-installation-url
GHL_REDIRECT_URI=https://your-vercel-domain.vercel.app/api/ghl/oauth/callback
GHL_OAUTH_USER_TYPE=Location
GHL_MCP_ACCESS_KEY=long-random-secret
GHL_TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)
KV_REST_API_URL=your-upstash-or-vercel-kv-rest-url
KV_REST_API_TOKEN=your-upstash-or-vercel-kv-rest-token
```

`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` also work instead of the `KV_*` names.

In the HighLevel Marketplace app settings, add this redirect URL:

```text
https://your-vercel-domain.vercel.app/api/ghl/oauth/callback
```

Then open the OAuth start URL in your browser:

```text
https://your-vercel-domain.vercel.app/api/ghl/oauth/start
```

After HighLevel redirects back, the callback page shows the `install_id`. Use this URL in Claude's custom connector screen:

```text
https://your-vercel-domain.vercel.app/api/ghl/mcp?access_key=long-random-secret&install_id=highlevel-install-id
```

The GoHighLevel MCP fails closed in production if `GHL_MCP_ACCESS_KEY`, encrypted token storage, or OAuth credentials are missing.

### GoHighLevel Tools

- `ghl_installation_status`: show the OAuth installation metadata without exposing tokens.
- `ghl_get_contact`: retrieve one contact by contact ID.
- `ghl_search_contacts`: search contacts with `/contacts/search`.
- `ghl_create_contact`: create a contact; requires `confirm: true`.
- `ghl_update_contact`: update a contact; requires `confirm: true`.
- `ghl_search_opportunities`: search opportunities with `/opportunities/search`.
- `ghl_api_call`: call any relative HighLevel API path; non-GET calls require `confirm: true`.

## Tools

- `gripp_list_entities`: list available Gripp entities and method names.
- `gripp_describe_entity`: inspect fields, enum values, references, methods, and examples for one entity.
- `gripp_get`: call `<entity>.get` with filters and options.
- `gripp_getone`: call `<entity>.getone` with filters.
- `gripp_create`: call `<entity>.create`; requires `confirm: true`.
- `gripp_update`: call `<entity>.update`; requires `confirm: true`.
- `gripp_delete`: call `<entity>.delete`; requires `confirm: true`.
- `gripp_call`: call any documented Gripp method by full name.
- `gripp_batch`: execute multiple documented Gripp calls in one transaction.

Non-read methods are blocked unless `confirm: true` is provided. This also applies to `gripp_call` and each item in `gripp_batch`.

## Examples

Find companies by name:

```json
{
  "entity": "company",
  "filters": [
    {
      "field": "company.companyname",
      "operator": "like",
      "value": "%Acme%"
    }
  ],
  "options": {
    "paging": {
      "firstresult": 0,
      "maxresults": 10
    },
    "orderings": [
      {
        "field": "company.companyname",
        "direction": "asc"
      }
    ]
  }
}
```

Call a nonstandard read method:

```json
{
  "method": "company.getCompanyByCOC",
  "params": ["12345678"]
}
```

Create a tag:

```json
{
  "entity": "tag",
  "fields": {
    "name": "Imported"
  },
  "confirm": true
}
```

## Metadata

The committed metadata snapshot is generated from the public API docs page:

```bash
npm run fetch:metadata
```

Refresh it when Gripp updates the API docs.
