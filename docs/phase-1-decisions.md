# Phase 1 decisions

## Reversible defaults

- NFT model: centrally managed Mindo asset, one unique internal asset code per purchased unit.
- Ownership model: stored in the Mindo database; customers do not need a crypto wallet.
- VND payments: VietQR generates the transfer instructions. A short-lived Bearer-authenticated callback confirms matching payments automatically; finance staff retain manual confirmation as a fallback.
- Commission and referral accounting: deferred to Phase 2 and kept off-chain initially.
- News: API support is included, but it is not on the critical purchase path.
- Contract upgradeability: disabled for the first release. New behavior is introduced with a versioned contract unless the governance model is approved.

## State transitions

- KYC: `PENDING -> APPROVED | REJECTED`.
- Deposit: `PENDING -> CONFIRMED | REJECTED`; only confirmation creates a credit ledger entry.
- Purchase: issued atomically as `COMPLETED`; `PENDING`, `FAILED`, and `CANCELLED` remain operational states for reconciliation.
- NFT product supply: `available = totalSupply - soldCount - reservedCount`.

All confirmation and review operations are idempotent, audited, and protected by admin roles.

KYC remains intentionally manual: customers upload identity data and protected documents, while Admin staff make the approval decision. There is no automated eKYC vendor in Phase 1.

## Phase 2 decisions

- Agency applications require completed KYC and manual Admin approval.
- The first approval produces one contract snapshot; later lock/unlock actions do not issue a second contract.
- Agency title thresholds are cumulative: packages 1–49 use 20%, 50–199 use 30%, and 200+ use 40%. A new rate starts on the package that reaches its threshold; package purchases snapshot the 25 USD list price, USD/VND rate and marginal price breakdown.
- Each package quantity creates the same number of eligible commission slots. A customer NFT order consumes one slot, regardless of NFT quantity.
- Commission is credited in the same database transaction as internal NFT issuance and is unique per order.
- AI work uses an asynchronous queue. Local development uses a deterministic mock; production uses an OpenAI-compatible API through environment configuration.
- AI expert capability flags control the product surface, while all provider prompts remain editable by Admin.
