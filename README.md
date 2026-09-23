# Mindo Platform — Phase 1 & 2

The platform includes the Phase 1 core plus the Phase 2 agency, commission, AI expert, and Admin RBAC modules while preserving the existing React Native app in the repository root.

## Included scope

- Investor authentication and profile
- Email OTP for account verification and password reset
- Private KYC file upload, manual submission, and admin review
- VietQR deposit requests, Bearer-authenticated callback reconciliation, and manual fallback
- Internal NFT catalog, quote, atomic purchase, issuance, and ownership history
- Admin operational dashboard and KYC workflow
- News list and admin CRUD API
- RBAC, append-only ledger entries, idempotency keys, and audit logs
- Agency application, manual approval, one-time contract, private store, and hierarchy
- Agency package tiers (1–49: 30%, 50–199: 40%, 200+: 50%) with commission capacity
- NFT orders attributed to an agency with idempotent commission settlement during internal issuance
- AI experts, conversation history, queued responses, image/document/translation task types, and SSE updates
- Agora audio/video calls, online signaling, active-call recovery, timeout handling, and call history
- Friend requests by email or phone with user-ID-based relationships
- User referral codes, configurable direct rewards, and system-issued branch-root sales rewards
- Admin agency operations, AI expert configuration, and role-based Admin account management

## Local setup

1. Copy `.env.example` to `.env` and replace all secrets.
2. Start PostgreSQL, Redis, and the local email inbox: `docker compose up -d`.
3. Install packages: `npm install`.
4. Generate the database client: `npm run prisma:generate -w api`.
5. Apply the committed schema: `npm run prisma:deploy -w api`.
6. Seed local data: `npm run prisma:seed -w api`.
7. Start the API and Admin in separate terminals: `npm run dev:api` and `npm run dev:admin`.

API documentation is available at `http://localhost:4000/docs`. Admin runs at `http://localhost:5173`. In development, OTP emails can be read in Mailpit at `http://localhost:8025`.

The app-facing registration, login, email verification, and password-reset contract is documented in [`docs/app-auth-api.md`](docs/app-auth-api.md).
The account profile, avatar, preferences, signed-in sessions, and app KYC contract is documented in [`docs/account-api.md`](docs/account-api.md).
The NFT purchase and VietQR deposit history contract is documented in [`docs/history-api.md`](docs/history-api.md).
The Agora audio/video calling flow and app integration contract is documented in [`docs/call-api.md`](docs/call-api.md).
The email/phone friend request and user-ID relationship contract is documented in [`docs/friend-api.md`](docs/friend-api.md).
The registration referral, branch dashboard, reward, and Admin configuration contract is documented in [`docs/referral-api.md`](docs/referral-api.md).

## OTP and KYC

Registration sends a five-minute OTP to the submitted email. OTP values are hashed in the database, rate-limited, invalidated after use, and never returned by the API. KYC images and PDFs are stored privately, limited to 10 MB, and exposed through short-lived signed URLs. Customers upload their information; compliance staff approve or reject it manually in Admin.

## VietQR

`VIETQR_MODE=quicklink` generates a standards-compatible VietQR image URL using the configured receiving bank account. Set `VIETQR_MODE=api` plus the VietQR base URL and credentials to use the token and `generate-customer` flow. If that upstream is unavailable, the API falls back to QuickLink unless fallback is explicitly disabled.

Create a deposit with `POST /api/v1/investor/deposits`. The response includes `vietqr.qr_code`, transfer content, amount, receiving account, and an at-most-19-digit order ID.

For the official callback flow, provide VietQR with these endpoints:

- `POST /vqr/api/token_generate`: VietQR calls this with Basic authentication; Mindo returns a short-lived Bearer token.
- `POST /vqr/bank/api/transaction-sync`: VietQR calls this with that Bearer token and the transaction payload.

Configure `VIETQR_CALLBACK_USERNAME`, `VIETQR_CALLBACK_PASSWORD`, and a separate `VIETQR_CALLBACK_JWT_SECRET`. Callback processing verifies the receiving account and amount, accepts both millisecond and second timestamps, can locate the transfer code inside decorated bank content, and is idempotent by bank transaction ID. The existing `POST /api/v1/webhooks/vietqr/transaction-sync` route remains available for controlled internal integrations using either the same Bearer token or `X-Webhook-Secret`.

With the local services and API running, `npm run test:e2e:local -w api` verifies email OTP, private file upload, manual Admin KYC approval, VietQR Bearer authentication, callback idempotency, balance crediting, deposit history/detail, and receipt download. It removes its temporary database records and files afterward.

## Phase 2 — Agency

Investors apply through `POST /api/v1/investor/agency/applications`. Admin staff review the application, and the first approval issues one immutable contract snapshot and activates the agency store. Approved agencies can configure their store, buy an NFT package, and view sales and commission history. Admin endpoints provide list, detail, metrics, hierarchy, review, locking, and contract download.

Agency package rules are stored on each purchase so later configuration changes do not rewrite historical commissions. A package provides a finite number of commission slots. When a customer buys through `agency_code`, the order uses one slot; the internal NFT and agency commission are issued together in the same database transaction and are unique by purchase order.

## Phase 2 — AI experts

AI messages are created with a pending assistant response and processed by the `ai-response` Redis queue. Conversation events are available over SSE. Supported task types are `CHAT`, `IMAGE`, `DOCUMENT`, and `TRANSLATION`. Generated Markdown documents have a protected download endpoint.

`AI_MOCK=true` is the safe local default. For a real OpenAI-compatible provider, set `AI_MOCK=false`, `AI_API_BASE_URL`, `AI_API_KEY`, and the chat/image model names. Provider errors mark the assistant message as failed and BullMQ retries the job.

With the local services and API running, `npm run test:e2e:phase2 -w api` verifies agency approval, one-time contract creation, store activation, package discount, immediate internal NFT issuance and commission, internal NFT history/detail, AI queue/document output, and Admin account RBAC. Temporary records are removed afterward.

## Audio and video calls

Mindo uses Agora RTC/RTM for audio, video, and online call signaling while keeping call state and history in the Mindo database. Configure the Agora values in `.env`, then use the authenticated `/api/v1/investor/calls` endpoints. The API prevents concurrent calls for either participant, separates app and web RTM identities, expires unanswered calls, and supports state recovery after the app reconnects.

With the local services and API running, `npm run test:e2e:calls -w api` verifies the complete API lifecycle. Background ringing after the mobile app has been terminated requires the mobile FCM/APNs and iOS PushKit/CallKit layer described in the call integration document.

## Friends

Investors can send friend requests using an email address or phone number. The identifier is resolved once to an account; requests and accepted relationships use only user IDs. Accepted friendships are stored in both directions with a composite user-ID primary key for fast list and search queries. Run `npm run test:e2e:friends -w api` for the full local workflow.

## Referral rewards

Every newly registered account receives a readable, unique Mindo referral code. A registration can provide either another user's code or a one-time system code created by Admin. A system code marks that account as the root of an important branch and cannot be reused.

When a purchase completes, the direct inviter receives the configured direct reward (10% by default). If the buyer belongs to a system-rooted branch, that root also receives the configured branch reward (5% by default) on the order. Both credits, their ledger entries, and the NFT issuance are committed in the same database transaction. Admin can change future-order rates, issue or disable system codes, and view each branch's complete downline sales.

The local seed creates these development-only accounts:

- Admin: `admin@local.test` / `ChangeMe123!`
- Investor: `investor@local.test` / `Investor123!`

Change or remove these credentials before any shared environment is exposed.

## Production domains

- Admin: `https://admin-mindo.stg-studio.com`
- API: `https://api-mindo.stg-studio.com`

The production Docker setup exposes only HTTP port 80 at the origin and relies on Cloudflare for public HTTPS. See [`deploy/README.md`](deploy/README.md) for DNS, environment, build, health-check, and rollout instructions.

## Internal NFT ownership

Mindo does not connect NFT ownership to a blockchain. After a successful VND balance purchase, the API atomically deducts the buyer balance, issues one unique `assetCode` per NFT, updates inventory, records the ledger entry, and credits any agency commission. NFT ownership is read from the Mindo database and does not require a crypto wallet, RPC endpoint, smart contract, gas fee, or private key.
