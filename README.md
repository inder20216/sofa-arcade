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

The default pairing server is the free public one, which has no uptime guarantee. Set your own in `js/config.js` before a public launch. Some networks (often guest, hotel and office Wi-Fi) block devices from reaching each other. The public relay may help there, with more delay.

## Controls

| Phone | Air Hockey | Ghat Rally | Carrom | Menus |
|---|---|---|---|---|
| Left thumb | Position in your half | Steer (or Tilt) | Pull back and release | Browse |
| A | Smash (just before contact) | Gas | | Select |
| B | | Brake | Striker right | Back |
| X | Cheer | Shove | Striker left | |
| Y | Pause | Pause | Pause | |

Carrom uses points rules: black 10, white 20, queen 50. The queen must be covered in the same shot or the next. Pocketing the striker costs 10.

TV remote: arrows and OK in menus, Back or OK to pause. To try the controller on a computer, use the arrow keys and J, K, U, I for A, B, X, Y.

## Add a game

Create `js/games/my-game.js`, call `Games.register({...})` (the interface is described in `js/games/registry.js`), and add a script tag in `index.html`. Games never touch the network. After changing a file, raise its `?v=` number in the HTML so browsers fetch the new copy.

## Third-party files

- [PeerJS](https://peerjs.com) 1.5.4, MIT, transpiled for older TV browsers
- [three.js](https://threejs.org) r149, MIT, transpiled; loads only when a 3D game opens
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4, MIT
- Barlow and Barlow Condensed fonts, SIL Open Font License 1.1
