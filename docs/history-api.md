# Mindo app history API

All endpoints require `Authorization: Bearer <access_token>`. The base path is `/api/v1/investor/history`.

## NFT purchase history

`GET /nfts`

Supported query parameters:

- `from`, `to`: ISO calendar dates such as `2026-09-01`, interpreted in Vietnam time.
- `status`: `pending`, `completed`, `failed` or `cancelled`.
- `project_id`: NFT collection/product ID.
- `page`, `limit`: pagination; the maximum page size is 100.

The response contains the all-time summary used by the Figma card, filtered and paginated rows grouped by month, and the applied filters. Monetary values are decimal strings in VND. Estimated profit/loss uses the current collection price as the valuation basis.

`GET /nfts/:id` returns the transaction overview, collection, internal NFT codes, unit price, issuer information and navigation IDs.

NFT ownership is managed entirely inside Mindo. The detail contract therefore returns `ownership_system: "MINDO_INTERNAL"`, while blockchain transaction and wallet fields are explicitly `null`.

## Deposit history

`GET /deposits`

Supported query parameters:

- `from`, `to`: ISO calendar dates in Vietnam time.
- `status`: `pending`, `completed` or `failed`.
- `source`: currently `VIETQR`.
- `page`, `limit`: pagination.

The response contains total confirmed deposits, confirmed/total/pending counts, available sources, and filtered rows grouped by month. Pending rows include the reconciliation message shown in the Figma design.

`GET /deposits/:id` returns the transfer code, bank reference, amount, fee, payment status and Mindo wallet balance before/after crediting.

The VietQR callback used by this project does not provide the sender's bank or source account. These two fields are returned as `null` with `source_data_available: false`; the receiving bank account is not incorrectly presented as the sender account.

For confirmed deposits, `GET /deposits/:id/receipt` downloads a UTF-8 text receipt. Pending and rejected deposits do not expose a receipt.

## Response conventions

List responses follow the standard envelope:

```json
{
  "code": 200,
  "data": {
    "summary": {},
    "groups": []
  },
  "message": "Thành công",
  "extra": {
    "has_more": false,
    "last_page": 1,
    "limit": 20,
    "page": 1,
    "total": 0
  }
}
```

An empty history returns an empty `groups` array and zero-valued summary, allowing the app to render the Figma empty state without a separate endpoint. Loading and retry/error states remain client-side states.
