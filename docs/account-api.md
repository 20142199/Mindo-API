# Mindo app account API

All endpoints require `Authorization: Bearer <access_token>`. The standard base path is `/api/v1`.

## Account overview

`GET /investor/account`

Returns the data used by the “Tài khoản của tôi” and account-settings screens:

- `uid`, email, full name, phone number, address and private avatar URL.
- `account_type`: `personal` or `business`.
- Bank account name, number and bank name.
- Latest KYC status: `none`, `pending`, `approved` or `rejected`, including rejection reason.
- Onboarding completion flags.

## Edit profile and avatar

Upload an avatar first with `POST /investor/files/upload` using `multipart/form-data` and field name `file`. JPG, PNG and WebP images up to 10 MB are accepted and stored privately.

Then call `PATCH /investor/account/profile`:

```json
{
  "full_name": "Nguyễn Văn An",
  "phone_number": "(+84) 901 234 567",
  "address": "Thành phố Hồ Chí Minh",
  "avatar_file_id": "uploaded-file-id"
}
```

Every field is optional, so the app can submit only changed values. The avatar file must belong to the authenticated user and must be an image.

## Account settings

Read settings with `GET /investor/account/settings`.

Update settings with `PATCH /investor/account/settings`:

```json
{
  "language": "vi",
  "suspicious_login_alerts": true,
  "login_rate_limit_enabled": true,
  "in_app_notifications": true,
  "email_notifications": true
}
```

Supported interface languages are `vi` and `en`. The response also includes nullable `support_center_url`, configured with `SUPPORT_CENTER_URL`. When suspicious-login alerts are enabled, a login from a new device or IP triggers a security email. Login-rate limiting temporarily locks the account after repeated wrong passwords; the global API rate limit remains active regardless of this preference.

## Signed-in sessions

To populate “Phiên đăng nhập”, call `GET /investor/account/sessions`. Each item includes:

- `id`, device name and device type.
- Masked IP address and optional location.
- `is_current`, `last_used_at` and `created_at`.

The app can supply session display metadata when logging in:

```json
{
  "email": "an@example.com",
  "password": "Mindo123!",
  "device_info": "iPhone 16 - Mindo",
  "device_type": "mobile",
  "device_location": "Hồ Chí Minh",
  "fcm_token": "optional-push-token"
}
```

- `DELETE /investor/account/sessions/:id`: revoke one session.
- `DELETE /investor/account/sessions`: revoke every session.
- `POST /investor/auth/logout`: revoke the current session.
- `POST /investor/auth/logout-all`: revoke every session.

After revocation, the app should remove its locally stored access and refresh tokens.

## KYC personal and bank information

Upload the front of the CCCD, back of the CCCD and selfie holding the CCCD separately with `POST /investor/files/upload`. Then submit:

`POST /investor/kyc/submissions`

```json
{
  "full_name": "Nguyễn Văn An",
  "email": "an@example.com",
  "phone_number": "0901234567",
  "address": "Thành phố Hồ Chí Minh",
  "bank_account_name": "NGUYEN VAN AN",
  "bank_account_number": "0301000456845",
  "bank_name": "Vietcombank",
  "id_front_file_id": "front-file-id",
  "id_back_file_id": "back-file-id",
  "selfie_file_id": "selfie-file-id"
}
```

`date_of_birth` and `id_card_number` remain optional for compatibility if the app collects them later. The submitted email, when present, must match the authenticated account.

Read the latest submission with `GET /investor/kyc/submissions/current`. Its response includes private signed URLs for all three images, status, review note and rejection reason. A rejected application may be corrected and submitted again; a second application cannot be created while another one is pending.
