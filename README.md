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
      "args": ["/absolute/path/to/MCP Gripp/dist/src/server.js"],
      "env": {
        "GRIPP_API_TOKEN": "your-token"
      }
    }
  }
}
```

After publishing or linking the package, you can also run the `gripp-mcp` binary.

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
