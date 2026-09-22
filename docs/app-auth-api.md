# Mindo app authentication API

Base URL: `/api/v1/investor/auth`

Successful responses use this envelope:

```json
{
  "code": 200,
  "data": {},
  "message": "Thành công",
  "extra": {
    "has_more": false,
    "last_page": 1,
    "limit": 0,
    "page": 1,
    "total": 0
  }
}
```

## Registration

`POST /register`

```json
{
  "full_name": "Nguyễn Văn An",
  "email": "an@example.com",
  "password": "Mindo123!",
  "confirm_password": "Mindo123!",
  "accept_terms": true,
  "ref_by": "MDABCDEFGH"
}
```

`nickname` and `ref_by` are optional. `ref_by` accepts a normal user's Mindo referral code or an unused system-issued branch code. The API creates a new unique `referral_code` for every account, records terms acceptance, and sends a six-digit OTP by email. The response contains the user and their `referral_code`, `verification_required: true`, plus `otp.expires_in` and `otp.resend_available_in` in seconds.

To resend the registration OTP, call `POST /register/otp`:

```json
{ "email": "an@example.com" }
```

The app should use `resend_available_in` for the one-minute resend countdown shown in the design.

Like `POST /forgot-password`, this endpoint returns the same successful shape whether or not the email exists, and whether or not it is already verified. It used to answer `Email không tồn tại` / `Email đã được xác thực`, which let anyone probe a list of addresses and learn which ones were registered.

## Email verification

`POST /verify-account`

```json
{
  "email": "an@example.com",
  "otp": "123456"
}
```

On success, show the registration-success screen and direct the user to log in. OTP is single-use, expires after the configured TTL, and is locked after repeated invalid attempts.

## Login

`POST /login/email`

```json
{
  "email": "an@example.com",
  "password": "Mindo123!",
  "remember_me": true,
  "fcm_token": "optional-device-push-token",
  "device_info": "optional-device-description"
}
```

The response returns `user`, `access_token`, and `refresh_token`. `remember_me` is accepted to match the app form; whether credentials remain on the device is controlled by the app's secure storage. An unverified account receives HTTP 403.

Use `Authorization: Bearer <access_token>` for protected requests. Rotate tokens with `POST /refresh-token`:

```json
{ "refresh_token": "..." }
```

Log out the current session with authenticated `POST /logout`, or every session with `POST /logout-all`.

## Forgot password

Step 1 — send email OTP with `POST /forgot-password`:

```json
{ "email": "an@example.com" }
```

The API deliberately returns the same successful shape when an email is unknown, avoiding account discovery.

Step 2 — verify the six-digit OTP with `POST /forgot-password/verify-otp`:

```json
{
  "email": "an@example.com",
  "otp": "123456"
}
```

The response contains a short-lived `reset_token` and `expires_in` in seconds.

Step 3 — save the new password with `POST /reset-password`:

```json
{
  "reset_token": "...",
  "new_password": "Mindo456!",
  "confirm_password": "Mindo456!"
}
```

The reset token can only be used once. A successful reset revokes every refresh token previously issued for that account.

## Change password

`POST /update-password`, authenticated.

```json
{
  "old_password": "Mindo123!",
  "new_password": "Mindo456!",
  "confirm_password": "Mindo456!"
}
```

The field names match `POST /reset-password`: both endpoints set a new password, so both call it `new_password`. The new password must differ from the current one. A successful change revokes every refresh token previously issued for that account, so other devices are signed out.

> The new-password field used to be named `password`, which read like the *current* password. It was renamed on 2026-09-23 together with the app. A client still sending `password` gets HTTP 400.

## Error codes

Every auth error carries a stable `code` beside the Vietnamese `message`, following the convention already used by `FriendService` and `CallService`:

```json
{
  "statusCode": 400,
  "message": "OTP không hợp lệ hoặc đã hết hạn",
  "code": "AUTH_OTP_INVALID"
}
```

Match on `code`, never on the text of `message` — the wording may change, and it will be translated.

| `code` | HTTP | Meaning |
| --- | --- | --- |
| `AUTH_INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `AUTH_EMAIL_NOT_VERIFIED` | 403 | Email not verified — send the user to the OTP screen |
| `AUTH_ACCOUNT_LOCKED` | 429 | Temporarily locked after repeated failures |
| `AUTH_NOT_ADMIN` | 401 | Not an administrator account |
| `AUTH_EMAIL_TAKEN` | 409 | Registration email already exists |
| `AUTH_CONFIRM_MISMATCH` | 400 | Password confirmation does not match |
| `AUTH_REFERRAL_INVALID` | 400 | Referral code not recognised |
| `AUTH_OTP_INVALID` | 400 | OTP wrong or expired |
| `AUTH_OTP_COOLDOWN` | 429 | Resend requested too soon |
| `AUTH_EMAIL_ALREADY_VERIFIED` | 400 | Email already verified |
| `AUTH_RESET_TICKET_INVALID` | 400 | `reset_token` wrong or expired |
| `AUTH_CURRENT_PASSWORD_WRONG` | 400 | Current password incorrect |
| `AUTH_PASSWORD_UNCHANGED` | 400 | New password equals the current one |
| `AUTH_REFRESH_INVALID` | 401 | Refresh token malformed |
| `AUTH_REFRESH_REVOKED` | 401 | Refresh token no longer valid |
| `AUTH_ACCOUNT_INACTIVE` | 401 | Account disabled |
| `VALIDATION_FAILED` | 400 | DTO rejected — see the `errors` array |

## Validation and status codes

- Passwords must contain at least eight characters **when registering, resetting, or changing** them.
- **Login does not check password length.** Any wrong password, whatever its length, returns the same `AUTH_INVALID_CREDENTIALS`. Checking length at login would leak the password policy and tell an attacker that "too short" differs from "wrong".
- OTP must contain exactly six digits.
- `confirm_password` must match the corresponding password.
- `accept_terms` must be `true` when registering.
- HTTP 400: invalid input, OTP, or reset session.
- HTTP 401: wrong email/password or invalid authentication token.
- HTTP 403: email has not been verified.
- HTTP 409: registration email already exists.
- HTTP 429: OTP resend cooldown or request rate limit.
- Validation messages are returned in Vietnamese, naming the field the way a user would read it ("Mật khẩu mới", not `new_password`). The full list is in the response's `errors` array.
