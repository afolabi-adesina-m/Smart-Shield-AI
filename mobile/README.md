# Smart-Shield on your phone

This is a small app for Android and iPhone. It talks to the same Smart-Shield server as the website. It does not contain the scoring model. The live server is:

https://smart-shield-ai.onrender.com

You can try it on a real phone with **Expo Go** from the store. This project uses **Expo SDK 57**, which matches the current App Store Expo Go (SDK 57) and the current Play Store Expo Go (57.0.9).

## Laptop off

The phone does not need the Windows laptop's Flask server.

- **Home Screen website (laptop powered off).** On the phone, open `https://smart-shield-ai.onrender.com/mobile` in Safari or Chrome. Share, then Add to Home Screen. That icon opens the map on mobile data or any Wi-Fi. The free Render service sleeps when idle, so the first open can take about a minute. This is the path that works with the laptop shut down.
- **Expo Go.** The app's API base defaults to `https://smart-shield-ai.onrender.com`. `EXPO_PUBLIC_API_URL` is an alias for `EXPO_PUBLIC_API_BASE`. You only change it to a `http://192.168…:5050` address when you are running Flask on a computer. Metro still has to be running to load the JavaScript into Expo Go, so the computer that started Expo cannot be off. If the phone is not on the same Wi-Fi as that computer, use the tunnel command below. The API calls still go to Render.

Sign-in is off on the class server. If someone sets `AUTH_REQUIRED=true` there, the app shows a username and password card and keeps the token on the phone. See the README section "Sign-in (optional)".

- **iPhone:** install Expo Go from the App Store. You do not need a Mac or an Apple Developer account for that test.
- **Android:** install Expo Go from the Play Store.

## Try it on your phone

1. Install Expo Go from the App Store or the Play Store.
2. On the computer, open a terminal in the `mobile` folder. If the folder path contains spaces, put quotes around it when you change directory.
3. Install the app's packages once:

   ```bash
   npm install
   ```

4. Start the phone preview with Node, not `npx`:

   ```bash
   node node_modules/expo/bin/cli start
   ```

   On Windows Command Prompt the same command is:

   ```bat
   node node_modules\expo\bin\cli start
   ```

5. A QR code appears in the terminal.
   - **Android:** open Expo Go and scan the QR code.
   - **iPhone:** open the Camera app and scan the QR code. It offers to open Expo Go.

The phone and the computer need to be on the same Wi-Fi. If they are not, start with a tunnel instead:

```bash
node node_modules/expo/bin/cli start --tunnel
```

### Windows folder names that contain `&`

A path such as `INFO53883 - AI & ML Capstone Project` breaks `npx expo start` and `npm run start`. Command Prompt treats `&` as "run another command", and the Expo and npm launcher scripts do not quote that path. Use the `node node_modules\expo\bin\cli start` command above. It does not put the project path on the command line.

If `npm install` fails for the same reason, call npm through Node. The quotes matter:

```bat
node "%ProgramFiles%\nodejs\node_modules\npm\bin\npm-cli.js" install
```

### Windows firewall

The first time Node starts, Windows may ask for network access. Allow **Node.js** on **Public** networks as well as private ones. If you only allow private networks, the phone cannot reach the computer and the QR code does nothing. You can change this later in Windows Security, Firewall, Allow an app.

The first time you tap **Find safest route**, wait. The free server sleeps when it is idle, and the first answer can take about a minute. The app says so on screen and tries again by itself.

### Use your own server

Skip this when the phone should use Render. The default API host is already `https://smart-shield-ai.onrender.com`.

Copy `.env.example` to `.env` and set the address of the Flask demo. Use the computer's network address, not `localhost`, so the phone can reach it:

```bash
EXPO_PUBLIC_API_BASE=http://192.168.1.20:5050
```

Restart `node node_modules/expo/bin/cli start` after you change that file.

## What you can do in the app

The screen opens on a dark navigation map. Search, route scores, fleet, and practice sit in **Trip tools** (the search button, **Where to?**, or **Route options**).

- Search a start and a destination. Suggestions appear after a few letters.
- Set the start to your current location.
- Compare up to three drives. Each card shows the safety score, risk tier, recommended speed, collision risk, and the Stage A fatal flag (shown only, not mixed into the score).
- Read the alert line and whether weather came from a live lookup or the calendar fallback.
- Follow the turn banner, the arrival card, and the bright route line. **Exit** leaves navigation.
- See the posted limit on a white speed-limit sign beside your speed. On a phone the speed is live GPS. The tile turns amber above the safe speed and red, with a vibration, over the posted limit. The safe speed comes from the road you are on and, once you have scored a route, from that route's recommended speed.
- The compass button recentres the map and switches between heading-up and north-up. It uses the phone compass when the GPS course is not available.
- Turn instructions and the over-limit warning are spoken. The speaker button mutes that voice.
- **Report** saves a hazard, police, crash, closure, or speed-camera note on the phone. The server does not store those notes.
- If GPS is off, or you are indoors, or you are using a computer browser, open Trip tools and tap **Simulate a speed**. Pick 30, 40, 50, 60, 80, 100, or 120.
- Open **Fleet** to start and stop a trip. The phone keeps the GPS trace, speeding events (where, posted limit, your speed, and how long), harsh braking and acceleration, and a driver safety score. Past trips stay on the phone. The server does not store them.
- **Play sample trip** drives a baked Highway 403 exit in Mississauga so you can see the score without leaving the room. It uses the same street and exit rules as the website.
- Open **Practice**, pick an Ontario DriveTest centre and G2 or G, and build a practice loop. Those loops are suggestions from public maps. They are not official test routes.

A trip records while the Fleet screen is open and the app is in the foreground. Locking the phone pauses new GPS samples.

## Check the types

```bash
node node_modules/typescript/bin/tsc --noEmit
```

## An installable Android app (APK)

Expo Go is the quick test. An APK is a file you can send and install without Expo Go.

1. Create a free Expo account and log in: `node node_modules/eas-cli/bin/run login` after `npm install eas-cli`, or `npx eas-cli login` if your folder path has no `&`.
2. From the `mobile` folder:

   ```bash
   npx eas-cli build -p android --profile preview
   ```

   If the folder path contains `&`, install the CLI locally (`node "%ProgramFiles%\nodejs\node_modules\npm\bin\npm-cli.js" install eas-cli`) and run `node node_modules/eas-cli/bin/run build -p android --profile preview`.

The `preview` profile in `eas.json` builds an APK. When the build finishes, Expo gives you a link to download it. On the phone, open the file and allow install from that source if Android asks.

## iPhone, beyond Expo Go (TestFlight)

Scanning the QR code with Expo Go does **not** need an Apple Developer account.

Installing a build that is not Expo Go **does**. You need an Apple Developer Program membership. Then, from the `mobile` folder:

```bash
npx eas-cli build -p ios --profile testflight
```

If the folder path contains `&`, use `node node_modules/eas-cli/bin/run build -p ios --profile testflight` after installing `eas-cli` in this folder. The `testflight` profile is a store build. After it finishes, submit it to TestFlight with `node node_modules/eas-cli/bin/run submit -p ios`. Invite testers from App Store Connect. The first iOS build also asks Expo to create signing certificates. Say yes.

## Map

On a phone, Expo Go draws the native map. iPhone uses Apple Maps, which needs no key. Android uses Google Maps with the key built into Expo Go for development, so you do not add a paid key. The map is light in the daytime and dark after local sunset. The turn banner, buttons, speed tile, and arrival card follow that same day or night colour.

The browser preview still uses OpenStreetMap, because the native map does not run there. It uses the same day and night colours.

Traffic lights and stop signs come from OpenStreetMap when that lookup answers. A regular stop is a red octagon with the word STOP. A stop tagged as all-way uses that same sign with a white ALL WAY plate under it. If the lookup fails, those icons are left off.
