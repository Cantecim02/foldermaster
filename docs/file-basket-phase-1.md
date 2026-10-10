# File Basket — phase 1

The home Game card opens a full-screen local mini game. Drag the file toward
the hoop and release; displacement selects launch direction and power.
The dotted preview uses the same fixed-step gravity/collision solver as flight.
The file must descend through the rim opening and the net exit to score.
Rim/backboard impacts bounce the file; floor contact ends a miss.

## Preview progress

- One round per rolling 24 hours, measured from its first shot on this device.
- Up to three shots, with one successful point per round.
- Five points become one preview credit; failed rounds preserve earlier progress.
- Preview credits remain stored and have no conversion redemption action.
- The attempt is saved before flight. Closing/backgrounding during flight uses
  the shot; it cannot be resumed for a free extra attempt.
- State is stored under `editio.fileBasket.preview.v1` in AsyncStorage, separate
  from accounts, subscriptions, conversion quotas, and history.
- Read failures do not overwrite saved state; write failures stop play.

This is a device-only reward preview, not a trusted reward ledger. It does not
change any real balance or call the backend. Reinstallation/storage deletion or
device clock changes can affect local progress. Phase 2 must authorize rounds,
validate results, and store/redeem credits server-side before rewards become real.

The game uses existing React Native, SVG, AsyncStorage and icon dependencies;
no game engine or native module was added. Turkish and English game copy is
included; other app languages currently use English game copy.

## Verification

```sh
npm run typecheck
npm run test:game
npm run test:routing
npm run test:monetization
```

Before an iPhone/TestFlight build, verify on a physical device:

1. Open Game from home and return without losing selected conversion files.
2. Test drag/release, preview, rim/backboard bounces, a basket, and three misses.
3. Close/reopen and background during flight; the shot remains consumed.
4. Verify successful rounds lock further attempts and points survive failed rounds.
5. Verify the five-point preview credit stays saved and real billing is unchanged.
6. Check light/dark themes, portrait/landscape layouts, and a small iPhone.
7. Smoke-test PDF, ZIP, account and conversion flows after returning from Game.

Use the existing iOS EAS production profile when preparing TestFlight. Keep the
existing monetization flags disabled. This change needs no backend deployment,
production configuration changes, additional permissions or CocoaPods dependency.
