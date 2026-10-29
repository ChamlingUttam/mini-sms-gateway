# Mini SMS Gateway

A JWT-protected REST API for sending SMS through prioritized mock providers,
tracking message attempts, and managing user wallet credits. Uses PostgreSQL
with Prisma.

## Setup

Requirements: Node.js 22+ and PostgreSQL.

```sh
npm ci
cp .env.example .env
```

Set `DATABASE_URL` to the application database URL, `DIRECT_URL` to the direct
database URL used for migrations, and `JWT_SECRET` to a secret of at least 32
bytes. Then run:

```sh
npx prisma migrate deploy
npx tsx prisma/seed.ts
npm run dev
```

The API defaults to `http://localhost:3000`. New accounts receive 100 credits.
Use `npm run build` to compile and `npm start` to run the compiled server.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/auth/register` | Create an account and wallet |
| `POST` | `/auth/login` | Get a JWT |
| `GET` | `/auth/me` | Get the authenticated user's account and balance |
| `POST` | `/sms/send` | Send a message to multiple recipients |
| `GET` | `/sms/messages` | Paginated message history |
| `GET` | `/sms/messages/:id` | Message details and provider attempts |
| `GET` | `/routes/health` | Provider balance, 24-hour success rate, and health |
| `GET` | `/health` | API status |

SMS endpoints require `Authorization: Bearer <token>`. Example send request:

```json
{
  "to": ["+9779812345678"],
  "message": "Hello from Mini SMS Gateway"
}
```

Sending validates international-format phone numbers, rejects duplicate
recipients, and limits each request to 100 numbers. Cost is one credit per
message part; the current part calculation uses 160 characters for one part
and 153 characters per additional part. The full batch cost is reserved in a
database transaction. Providers are tried in priority order; if every route
fails, the affected message is marked failed and its credits are refunded.

Message history accepts `page` and `limit` query parameters (`limit` is capped
at 50). The authenticated `GET /routes/health` response includes each provider's
balance, successful and failed attempt counts, 24-hour success rate, balance
score, and health percentage. The success rate is `successful attempts ÷
(successful + failed attempts) × 100`. Health uses:

`health % = 0.8 × success rate % + 0.2 × balance score %`

The balance score is `min(provider balance ÷ 1,000, 1) × 100`. If a provider
has no attempts in the last 24 hours, its success rate is returned as `null`
and the health calculation uses a neutral reliability score of 100%.
`/sms/providers/health` remains available as an alias.

Mock providers are seeded in `prisma/seed.ts`. A recovery worker checks every
minute and refunds messages left in `PROCESSING` for more than 10 minutes.

## Tests

```sh
npm test
npm run typecheck
```
