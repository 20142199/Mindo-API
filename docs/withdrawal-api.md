# Withdrawal API

All endpoints require an access token. Amounts are integer VND strings.

## App and web

### Create a withdrawal

`POST /api/v1/investor/withdrawals`

Required header: `Idempotency-Key`. Reusing the same key and payload for the same user returns the original withdrawal and never debits twice. Reusing that key with a different payload returns `409 Conflict`.

```json
{
  "amount_vnd": "500000",
  "bank_name": "Ngân hàng Á Châu (ACB)",
  "bank_account_number": "13989647",
  "bank_account_name": "TRAN DUY HUNG"
}
```

The API atomically checks the available balance, debits/holds the amount, creates the pending withdrawal, and writes its ledger entry in one serializable database transaction.

- `GET /api/v1/investor/withdrawals`
- `GET /api/v1/investor/withdrawals/:id`

## Admin and Treasurer

Roles `ADMIN` and `FINANCE` can use these endpoints:

- `GET /api/v1/admin/withdrawals?status=PENDING`
- `GET /api/v1/admin/withdrawals/:id`
- `POST /api/v1/admin/withdrawals/proof/upload` with multipart field `file`
- `POST /api/v1/admin/withdrawals/:id/approve`
- `POST /api/v1/admin/withdrawals/:id/reject`

Approve after uploading the transfer image:

```json
{
  "transaction_code": "ACB260907001",
  "transfer_proof_file_id": "file-id",
  "review_note": "Đã chuyển khoản"
}
```

Reject with a user-visible reason:

```json
{
  "reason": "Thông tin chủ tài khoản không khớp"
}
```

Approval does not debit the balance again. Rejection changes the status and refunds the held amount in one serializable transaction. Repeating either review action is idempotent and cannot refund twice. A Firebase push is sent after a successful state change when FCM credentials and a current device token are available.
