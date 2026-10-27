# Launch checks

Operator checklist for the GitHub App and public-activity validation. Automated tests cover the webhook and the contribution rules with fake GitHub responses. These steps still need a live provider. Do not record client secrets, webhook secrets, tokens, or private activity in a public issue or pull request. Keep credentials in each instance's external environment file.

Issues 2 and 3 stay open until these live checks are done.

## GitHub Apps

Create one development app and one production app. Do not reuse credentials between them.

- Homepage URL: that instance's `APP_URL`.
- Authorization callback: `APP_URL/api/auth/callback/github`.
- Account permission: Email addresses, read-only.
- No repository permissions and no organization permissions. Installing the app on repositories is not required.
- Enable expiring user access tokens. The app requests `offline_access` only; default OAuth scopes are disabled.
- Webhook URL: `APP_URL/api/github/webhook`, with its own random webhook secret.
- Put the client id, client secret, and webhook secret only in that instance's external environment file.
- Confirm each environment can open the GitHub authorization screen.

## Revocation, consent, and public activity

Use a controlled personal account.

- Before publication consent, the profile is absent from the public profile page and both leaderboards. Publish only after the explicit consent checkbox.
- Revoke the app from the account's GitHub settings. The webhook delivery is HTTP 200. The profile moves to the reconnect state, stored GitHub tokens are cleared, and an agent key that worked before revocation is rejected.
- Compare 7-day and 30-day public commits, opened pull requests, opened issues, and pull request reviews with the public GitHub profile. Repeat with an account that also has private or internal activity and confirm those counts are absent.
- ShipKudos groups days in UTC. GitHub's contribution calendar uses the viewer's time zone, so a contribution near midnight can fall on different dates. Small daily differences are expected. Compare the four public categories above, not the calendar square total. That total can include other activity and, when the person has opted in, restricted private counts.
