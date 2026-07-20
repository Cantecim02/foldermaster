# Editio Apple Subscription Setup

This document covers the App Store Connect and production-secret work that must be completed by the Editio account owner. The repository contains the integration code, but local StoreKit products do not create real App Store products.

## Fixed identifiers

| Item | Value |
| --- | --- |
| Bundle ID | `com.cantecim.editio` |
| Apple App ID | `6790405876` |
| Subscription group reference name | `Editio Pro` |
| Monthly product ID | `com.cantecim.editio.pro.monthly` |
| Yearly product ID | `com.cantecim.editio.pro.yearly` |
| Production notification URL | `https://api.editioapp.com/billing/apple/notifications` |
| Sandbox notification URL | `https://api.editioapp.com/billing/apple/notifications` |

Product IDs are permanent after creation. Check every character before saving them in App Store Connect.

## 1. Agreements, tax and banking

1. Open App Store Connect, then **Business**.
2. Confirm the Paid Apps Agreement is active.
3. Complete tax forms and banking information for the legal entity.
4. Resolve any agreement warning before expecting paid products to load in TestFlight.

## 2. Create the subscription group and products

1. Open **My Apps > Editio > Monetization > Subscriptions**.
2. Create one subscription group with reference name `Editio Pro`.
3. In that same group, create an auto-renewable monthly product:
   - Reference name: `Editio Pro Monthly`
   - Product ID: `com.cantecim.editio.pro.monthly`
   - Duration: one month
4. Create an auto-renewable yearly product in the same group:
   - Reference name: `Editio Pro Yearly`
   - Product ID: `com.cantecim.editio.pro.yearly`
   - Duration: one year
5. Add at least Turkish and English subscription localizations.

Suggested names and descriptions:

| Locale | Monthly name | Monthly description | Yearly name | Yearly description |
| --- | --- | --- | --- | --- |
| Turkish | Editio Pro Aylık | Ücretsiz haklardan sonra desteklenen yeni dönüşümlere aylık erişim. | Editio Pro Yıllık | Ücretsiz haklardan sonra desteklenen yeni dönüşümlere yıllık erişim. |
| English | Editio Pro Monthly | Monthly access to supported new conversions after the free allowance. | Editio Pro Yearly | Yearly access to supported new conversions after the free allowance. |

Do not use “unlimited”. Existing file-size, security, fair-use and rate limits still apply.

## 3. Price, availability and optional introductory offer

1. Choose prices in App Store Connect; do not copy prices into source code or the website.
2. Review Apple’s generated storefront prices and tax behavior.
3. Select the storefronts where Editio will be available.
4. An introductory offer is optional. If a yearly free trial is added later, configure it only in App Store Connect.
5. The app asks StoreKit for the actual localized price, duration, offer metadata and eligibility. It does not promise a trial when StoreKit does not return an eligible offer.

## 4. Create the In-App Purchase key

1. Open **Users and Access > Integrations > In-App Purchase** in App Store Connect.
2. Create an In-App Purchase key with the minimum required access.
3. Record the Issuer ID and Key ID.
4. Download the `.p8` key once and store it in a password-protected secret store.
5. Never add the key to Git, EAS public variables, JavaScript, a mobile bundle or the website.

For the backend, place the key outside the application source tree and mount it read-only into the container. Example target path:

```text
/run/secrets/editio-iap-key.p8
```

Set mode `600` on the host. The production backend rejects a private-key file readable by group or other users.

## 5. Install Apple root certificates

Download the current Apple root certificate files from Apple PKI. Keep DER-encoded `.cer` or `.der` files in a repository-external directory and mount that directory read-only, for example:

```text
/run/secrets/apple-root-cas/
```

Do not use an arbitrary web certificate. The backend passes these certificates to Apple’s official `SignedDataVerifier`.

## 6. Configure production environment

Keep both coordinated feature flags `false` until all products, credentials and Sandbox tests are complete.

Backend variables:

```dotenv
MONETIZATION_ENABLED=false
FREE_CONVERSION_LIMIT=3
CONVERSION_AUTHORIZATION_TTL_MINUTES=15
APPLE_BUNDLE_ID=com.cantecim.editio
APPLE_APP_ID=6790405876
APPLE_MONTHLY_PRODUCT_ID=com.cantecim.editio.pro.monthly
APPLE_YEARLY_PRODUCT_ID=com.cantecim.editio.pro.yearly
APPLE_IAP_ISSUER_ID=
APPLE_IAP_KEY_ID=
APPLE_IAP_PRIVATE_KEY_PATH=/run/secrets/editio-iap-key.p8
APPLE_IAP_ENVIRONMENT=Sandbox,Production
APPLE_ROOT_CA_DIRECTORY=/run/secrets/apple-root-cas
APPLE_NOTIFICATION_PRODUCTION_URL=https://api.editioapp.com/billing/apple/notifications
APPLE_NOTIFICATION_SANDBOX_URL=https://api.editioapp.com/billing/apple/notifications
```

Mobile EAS variables:

```dotenv
EXPO_PUBLIC_MONETIZATION_ENABLED=false
EXPO_PUBLIC_EDITIO_MONTHLY_PRODUCT_ID=com.cantecim.editio.pro.monthly
EXPO_PUBLIC_EDITIO_YEARLY_PRODUCT_ID=com.cantecim.editio.pro.yearly
```

`EXPO_PUBLIC_` values are visible in the application bundle and therefore must never contain Apple credentials.

## 7. Configure App Store Server Notifications V2

1. Open the Editio app in App Store Connect.
2. Find **App Store Server Notifications**.
3. Select version 2.
4. Set the Production Server URL to `https://api.editioapp.com/billing/apple/notifications`.
5. Set the Sandbox Server URL to the same endpoint.
6. Send Apple’s test notification after the new backend is deployed with monetization enabled.
7. Confirm an HTTP 200 response and one idempotent event in `app_store_notification_events`.

The notification route is public by design. It authenticates Apple through signed JWS verification and does not require an Editio session token. Never log the signed payload.

## 8. Create a Sandbox tester

1. Open **Users and Access > Sandbox > Testers**.
2. Create a new test Apple Account that has never been used for real App Store purchases.
3. On a physical iPhone development/TestFlight build, sign in with the Sandbox account when StoreKit requests it.
4. Test purchase, renewal, cancellation, billing retry/grace if configured, expiration, refund/revoke handling, restore and Manage Subscription.

Local Xcode StoreKit testing is described in `docs/apple-subscription-manual-tests.md`; it does not replace Sandbox testing.

## 9. Submit the first subscriptions with the app version

1. Complete each subscription’s localization, price, availability and review screenshot.
2. Confirm both products reach **Ready to Submit**.
3. Add the first subscription products to the Editio app version’s In-App Purchases and Subscriptions section.
4. Upload a build that includes `expo-iap` and points to the production API.
5. Add the subscription review notes from `docs/app-store-metadata-subscriptions.md`.
6. Do not claim purchase testing passed until a physical-device Sandbox purchase and restore both pass.

## 10. App Privacy and review checks

Update App Privacy to reflect the production behavior:

- Contact Info: email address and name when an optional account/support request is used.
- User Content: files submitted temporarily for requested conversion, and support attachments.
- Identifiers: Editio user ID and a random installation identifier.
- Purchases: subscription product/transaction/entitlement metadata.
- Usage Data: free conversion usage and signed-in conversion-history metadata.
- Diagnostics: only if the production build actually sends diagnostics remotely.
- Data is used for App Functionality and security; no tracking or advertising is used by this implementation.

Confirm the public pages are live and match the submitted build:

- `https://editioapp.com/privacy`
- `https://editioapp.com/terms`
- `https://editioapp.com/support`

## 11. Rollout order

1. Back up `/app/data/editio.sqlite` and verify the persistent `editio-data:/app/data` volume.
2. Deploy the backend code with `MONETIZATION_ENABLED=false` and run migrations/startup checks.
3. Configure secrets, certificates and Notifications V2.
4. Create and fully configure products in App Store Connect.
5. Run local StoreKit tests.
6. Run physical-device Sandbox tests with backend monetization enabled in the test environment.
7. Enable the backend production flag.
8. Build the matching mobile release with the mobile flag enabled.
9. Re-run purchase, restore, conversion quota, account deletion warning and Manage Subscription tests before submission.

Never enable only one side of the coordinated feature flag.

## Official references

- Apple subscriptions: https://developer.apple.com/app-store/subscriptions/
- App Store Server Notifications: https://developer.apple.com/documentation/appstoreservernotifications
- Notification URL setup: https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/enter-server-urls-for-app-store-server-notifications
- Apple server library: https://github.com/apple/app-store-server-library-node
- StoreKit testing: https://developer.apple.com/documentation/storekit/testing-in-app-purchases-in-xcode/
