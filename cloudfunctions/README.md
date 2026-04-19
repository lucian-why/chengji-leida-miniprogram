# Cloud Functions Deployment Notes

## Required environment variables

Functions that issue or verify legacy `users.token` require:

- `TOKEN_SALT`: shared random secret for token generation.

`adminLogin` also requires:

- `ADMIN_PASSWORD`: administrator login password.

`sendEmailCode` also requires:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `FROM_NAME`

Do not commit real secret values. Configure them in CloudBase console or deployment pipeline before deploying these functions.

## Token behavior

`TOKEN_SALT` has no code fallback. If it is missing, login functions fail fast instead of issuing predictable tokens.

Changing `TOKEN_SALT` invalidates existing login tokens. Users need to log in again after rotation.
