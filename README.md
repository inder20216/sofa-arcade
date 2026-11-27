# Sofa Arcade

Play on the TV. Your phone is the controller. No app to install: the TV opens a web page, and phones scan its QR code.

- `index.html` is the TV screen
- `controller.html` is the phone controller

There is no build step. Everything is plain HTML, CSS and JavaScript.

## Host it on GitHub Pages

1. Push this folder to a GitHub repository, with `index.html` at the top level.
2. In the repository, open **Settings > Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then `main` and `/ (root)`.
4. Open `https://<user>.github.io/<repository>/` in the TV's browser.

## Run it locally

```
python -m http.server 8080
```

Open `http://<this computer's network address>:8080` on the TV or laptop. Phones cannot open a `localhost` link.

## How it connects

1. The TV registers a random six-character code with a pairing server (PeerJS).
2. The phone opens the link in the QR code, which contains that code.
3. The pairing server introduces the two, and they connect with WebRTC. On the same Wi-Fi the connection is normally direct.
4. Controller input uses a second channel that drops late packets instead of queueing them.

If a phone can't scan the code, open `https://<user>.github.io/<repository>/j` on it and type the code, or tap **Invite** on a connected phone to send the link.

Anyone with the code can join while a seat is free. Select a player on the TV to remove them.

The default pairing server is the free public one, which has no uptime guarantee. Set your own in `js/config.js` before a public launch. Some networks (often guest, hotel and office Wi-Fi) block devices from reaching each other. There is no working relay for these cases, so the TV and phones must share a network: the same Wi-Fi, or one phone's hotspot.

## Controls

| Phone | Air Hockey | Ghat Rally | Carrom | Road Trip | Menus |
|---|---|---|---|---|---|
| Left thumb | Position in your half | Steer (or Tilt) | Pull back and release | Steer (or Tilt) | Browse |
| A | Smash (just before contact) | Gas | | Gas | Select |
| B | | Brake | Striker right | Brake, then reverse | Back |
| X | Cheer | Hit a rival | Striker left | Autopilot | |
| Y | Pause | Pause | Pause | Pause | |

Ghat Rally: choose a lap race (1 to 30 laps) or a long ride (5 to 60 km on a new road each time), and Easy, Medium or Hard. Hurdles can be Off, Some or Lots: potholes and speed breakers taken fast slow you down, and fallen rocks and cows each cost a heart. The screen warns you before each one. The TV remembers the last choice. A hit scores 50 and the third hit knocks the rival down for 150 more. Finishing places add 400, 250, 150 and 75, and more in longer races. Most points wins. The screen splits by itself: 2 players side by side, 3 or 4 in quarters.

Carrom uses points rules: black 10, white 20, queen 50. The queen must be covered in the same shot or the next. Pocketing the striker costs 10.

TV remote: arrows and OK in menus, Back or OK to pause. To try the controller on a computer, use the arrow keys and J, K, U, I for A, B, X, Y.

## Full screen

- **TV or laptop:** the first OK press or click on the TV itself turns on full screen. Browsers don't allow a phone's button to do it. Press F or use **Full screen** on the home screen to switch it.
- **Android:** the controller goes full screen when you tap **Join**.
- **iPhone:** Safari has no full screen for web pages. Tap **Share > Add to Home Screen** once, then open Sofa Arcade from the Home Screen and type the code.

## Sound

Music, engines, crowd and effects are synthesised in `js/tv/sound.js`, with no audio files. Browsers block sound until someone presses a key or clicks on the TV itself, so the TV shows a reminder until then. Sound, music and the announcer have switches on the home screen, and the pause menu has Mute. The announcer uses only voices installed on the device; many TVs have none.

## Road Trip

Type any start and destination on a phone (up to 1,200 km), or choose a preset. The road, distance, lanes, bridges, tolls and hills are real, the weather is the current weather, and driving takes real time. Quick mode runs time 10 times faster while everyone is on autopilot. Progress is saved in the TV's browser.

- **Estimated:** traffic, most traffic signals, buildings, trees, and most hurdles.
- **Hurdles:** potholes, speed breakers, cows, dogs, people crossing, police checks, roadworks, breakdowns.
- **Challans:** amounts are game values. Real fines differ by state.
- **Live traffic:** needs a TomTom key in `js/config.js`. This has not been tested. Restrict the key to your site, because the file is public.

It sends place names and route positions to free public services: Photon (search), Valhalla at FOSSGIS (routes), Overpass (map features), Open-Meteo (weather) and Terrain Tiles on AWS. These have fair-use limits and no uptime guarantee, and Open-Meteo's free service is for non-commercial use. Use your own or paid services before a commercial launch. Map data (c) OpenStreetMap contributors, ODbL; keep the on-screen credit.

Map features for some presets are stored in `js/games/roadtrip/data`. Presets without a file load them live.

## Graphics

The home screen has **Graphics** (auto, high, low) and **Shake**. Auto lowers shadows, resolution and detail when the TV is slow.

## Add a game

Create `js/games/my-game.js`, call `Games.register({...})` (the interface is described in `js/games/registry.js`), and add a script tag in `index.html`. Games never touch the network. After changing a file, raise its `?v=` number in the HTML so browsers fetch the new copy.

## Third-party files

- [PeerJS](https://peerjs.com) 1.5.4, MIT, transpiled for older TV browsers
- [three.js](https://threejs.org) r149, MIT, transpiled; loads only when a 3D game opens
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4, MIT
- Barlow and Barlow Condensed fonts, SIL Open Font License 1.1
