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
  "accept_terms": true
}
```

`nickname` and `ref_by` are optional. The API creates the account, records terms acceptance, and sends a six-digit OTP by email. The response contains `verification_required: true` plus `otp.expires_in` and `otp.resend_available_in` in seconds.

To resend the registration OTP, call `POST /register/otp`:

```json
{ "email": "an@example.com" }
```

The app should use `resend_available_in` for the one-minute resend countdown shown in the design.

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

## Validation and status codes

- Passwords must contain at least eight characters.
- OTP must contain exactly six digits.
- `confirm_password` must match the corresponding password.
- `accept_terms` must be `true` when registering.
- HTTP 400: invalid input, OTP, or reset session.
- HTTP 401: wrong email/password or invalid authentication token.
- HTTP 403: email has not been verified.
- HTTP 409: registration email already exists.
- HTTP 429: OTP resend cooldown or request rate limit.
