# Editio Apple Subscription Manual Tests

Automated tests use fake decoded Apple transaction data and never call Apple production services. Complete the following tests before enabling monetization in an App Store build.

## Local Xcode StoreKit test

The shared `FileConverter` scheme is linked to:

```text
ios/FileConverter/Supporting/Editio.storekit
```

It contains the Editio Pro monthly and yearly test products. Test prices in this file are local fixtures, not production prices.

1. Open `ios/FileConverter.xcworkspace` after installing pods.
2. Select the `FileConverter` scheme and a development-signed iPhone target.
3. Confirm **Run > Options > StoreKit Configuration** is `Editio.storekit`.
4. Start Metro for the development client.
5. Run the app from Xcode with both monetization flags enabled in a local test environment.
6. In Xcode, use **Debug > StoreKit > Manage Transactions** to inspect, expire, refund or delete local transactions.

Verify:

- Monthly and yearly products show StoreKit display prices.
- A purchase stays pending until backend verification succeeds.
- Cancellation shows a neutral message.
- Repeated taps do not start multiple purchases.
- Restore activates an eligible existing purchase and is idempotent.
- Restore with no active purchase shows a clear empty result.
- Manage Subscription opens Apple’s subscription UI when available.
- Expiration removes Pro access after the verified date.
- Refund/revoke removes access.
- Automatic renewal disabled still grants access until expiration.
- An eligible introductory offer appears only when StoreKit reports both an offer and eligibility.

Local StoreKit-signed data is accepted only when the backend explicitly allows `Xcode`. Do not include `Xcode` in the final production environment list unless it is intentionally required by a separate test deployment.

## Sandbox / TestFlight test on a physical iPhone

Prerequisites:

- Paid Apps Agreement, tax and banking active.
- Both products configured and available in App Store Connect.
- Backend Sandbox verification credentials and Apple root certificates configured.
- App Store Server Notifications V2 Sandbox URL configured.
- A dedicated Sandbox tester.

Test matrix:

1. Fresh install receives a random SecureStore installation UUID.
2. App remains usable without an Editio account.
3. First, second and third completed conversion jobs consume one free credit each.
4. A multi-output conversion consumes one job credit.
5. Cancellation, corrupt file, unsupported file, network failure and backend failure release the reservation.
6. Two simultaneous requests never pass the lifetime limit.
7. Fourth new conversion opens the paywall; old files, history, Settings and support remain available.
8. Monthly purchase verifies on the backend before UI activation.
9. Yearly purchase verifies on the backend before UI activation.
10. Guest purchase works without registration.
11. Guest-to-account transition does not create a second free allowance.
12. Restore on a reinstall/new installation restores the valid Apple entitlement.
13. Duplicate restore and duplicate notification do not create duplicate entitlement rows.
14. Turning off auto-renew does not remove access before the verified expiration date.
15. Expiration removes access and reveals restore/plan controls.
16. Billing retry and grace-period status match the backend policy.
17. Refund/revoke removes access after the notification is processed.
18. Deleting the Editio account removes profile/history, anonymizes the billing link and does not claim to cancel Apple.
19. The same Apple purchase can be restored after account deletion.
20. Android remains unblocked and never shows Apple purchase controls.

## Evidence to retain

Retain non-sensitive evidence for release sign-off:

- Build number and commit.
- Product status screenshot from App Store Connect (without credentials).
- Successful Sandbox purchase and restore timestamps.
- Redacted backend request IDs for transaction verification and notification processing.
- Free quota tests and final entitlement state.

Do not retain signed payloads, auth tokens, private keys, email addresses, document contents or support attachments in test notes.
