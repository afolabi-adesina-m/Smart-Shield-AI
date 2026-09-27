# Smart-Shield on your phone

This is a small app for Android and iPhone. It talks to the same Smart-Shield server as the website. It does not contain the scoring model. The live server is:

https://smart-shield-ai.onrender.com

You can try it on a real phone with the free **Expo Go** app. You do not need a Mac, a Google Play account, or an Apple Developer account for that test.

## Try it on your phone

1. Install **Expo Go** from the Play Store (Android) or the App Store (iPhone).
2. On the computer that has this project, open a terminal in the `mobile` folder.
3. Install the app's packages once:

   ```bash
   npm install
   ```

4. Start the phone preview:

   ```bash
   npx expo start
   ```

5. A QR code appears in the terminal.
   - **Android:** open Expo Go and scan the QR code.
   - **iPhone:** open the Camera app and scan the QR code. It offers to open Expo Go.

The phone and the computer need to be on the same Wi-Fi. If they are not, start with a tunnel instead:

```bash
npx expo start --tunnel
```

The first time you tap **Find safest route**, wait. The free server sleeps when it is idle, and the first answer can take about a minute. The app says so on screen and tries again by itself.

### Use your own server

Copy `.env.example` to `.env` and set the address of the Flask demo. Use the computer's network address, not `localhost`, so the phone can reach it:

```bash
EXPO_PUBLIC_API_BASE=http://192.168.1.20:5050
```

Restart `npx expo start` after you change that file.

## What you can do in the app

- Search a start and a destination. Suggestions appear after a few letters.
- Set the start to your current location.
- Compare up to three drives. Each card shows the safety score, risk tier, recommended speed, collision risk, and the Stage A fatal flag (shown only, not mixed into the score).
- Read the alert line and whether weather came from a live lookup or the calendar fallback.
- See the posted limit, your speed, and the safe speed. On a phone the speed is live GPS. The safe speed comes from the road you are on and, once you have scored a route, from that route's recommended speed.
- If GPS is off, or you are indoors, or you are using a computer browser, tap **Simulate a speed** and pick 40, 60, 80, 100, or 120. Going over the posted limit turns the speed red and plays a short alert.
- Open **Fleet** to start and stop a trip. The phone keeps the GPS trace, speeding events (where, posted limit, your speed, and how long), harsh braking and acceleration, and a driver safety score. Past trips stay on the phone. The server does not store them.
- **Play sample trip** drives a baked Highway 403 exit in Mississauga so you can see the score without leaving the room. It uses the same street and exit rules as the website.
- Open **Practice**, pick an Ontario DriveTest centre and G2 or G, and build a practice loop. Those loops are suggestions from public maps. They are not official test routes.

A trip records while the Fleet screen is open and the app is in the foreground. Locking the phone pauses new GPS samples.

## Check the types

```bash
npm run typecheck
```

## An installable Android app (APK)

Expo Go is the quick test. An APK is a file you can send and install without Expo Go.

1. Create a free Expo account and log in: `npx eas-cli login`
2. From the `mobile` folder:

   ```bash
   npx eas-cli build -p android --profile preview
   ```

The `preview` profile in `eas.json` builds an APK. When the build finishes, Expo gives you a link to download it. On the phone, open the file and allow install from that source if Android asks.

## iPhone, beyond Expo Go (TestFlight)

Scanning the QR code with Expo Go does **not** need an Apple Developer account.

Installing a build that is not Expo Go **does**. You need an Apple Developer Program membership. Then, from the `mobile` folder:

```bash
npx eas-cli build -p ios --profile testflight
```

The `testflight` profile is a store build. After it finishes, submit it to TestFlight with `npx eas-cli submit -p ios`. Invite testers from App Store Connect. The first iOS build also asks Expo to create signing certificates. Say yes.

## Map

The map uses OpenStreetMap tiles. It does not need a Google or Mapbox key.
