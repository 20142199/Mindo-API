# Agency package titles and pricing

## Rules

- The list price is fixed at 25 USD per package.
- Admin configures the USD/VND conversion rate.
- Titles use the agency's cumulative purchased package count:
  - `TIER_1` / Đại lý 1: package 1–49, 20% discount.
  - `TIER_2` / Đại lý 2: package 50–199, 30% discount.
  - `TIER_3` / Đại lý 3: package 200 onward, 40% discount.
- Pricing is marginal. If an agency owns 40 packages and buys 20 more, packages 41–49 receive 20% and packages 50–60 receive 30%.
- Each purchase stores its USD price, conversion rate, VND price, package-number range, effective discount and tier-by-tier breakdown.
- Product commission uses the agency's current title rate while the agency has an active commission slot.

## Investor API

`GET /api/v1/investor/agency/packages/config`

Returns the public 25 USD price, current USD/VND rate, VND price and title thresholds.

`POST /api/v1/investor/agency/packages`

```json
{
  "quantity": 50,
  "product_id": "optional-active-product-id"
}
```

`product_id` is optional for compatibility. The API selects the first active internal product when it is omitted.

## Admin API

`GET /api/v1/admin/agency-package-settings`

Roles: admin, compliance and finance.

`PATCH /api/v1/admin/agency-package-settings`

Role: admin.

```json
{
  "usd_vnd_rate": 25000
}
```

The fixed list price remains 25 USD. Changing the rate only affects later package purchases and never rewrites historical purchase snapshots.
