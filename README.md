# DOCK

A silent, top-down procedural container-ship docking game for the browser. No dependencies, no build step and no audio. The only external navigation is the LinkedIn logo link and the optional Facebook share action.

## Objective

You have **180 seconds**. Bring the whole container ship into the illuminated berth, align it parallel with the quay, slow almost to a stop, and hold position briefly. Every successful docking generates a new harbor layout and berth assignment while the same timer continues.

### Scoring

Each safe docking is worth up to **280 points**:

- 100 base points
- up to +60 for centering in the berth
- up to +60 for alignment with the quay
- up to +60 for a gentle, low-speed approach
- collisions with quays, piers or harbor walls cost 25 points
- collisions with moored vessels cost 35 points

The run score can never go below zero.

## Game modes

Choose **Solo captain** for the original challenge or **Tug assist** to control a second vessel. Both watches last 180 seconds and score the main ship's docking in exactly the same way. The tug does not need to fit inside the berth.

The amber tug starts alongside in clear water. Attach within 78 world pixels of the main hull (roughly one tug length of open water). The HUD shows when the line is in range. A towline pulls at the attachment point: pull near the bow or stern to rotate the ship, or amidships to move it sideways. Slack line applies no force. Release and reconnect to choose another attachment point. An obstructed or overstretched line releases automatically. Detach before entering a tight berth.

You can also **push directly against the main hull**, with or without a towline. Keep the tug's engine or sideways thrusters engaged toward the ship to maintain pressure. Push amidships to shift it sideways, or near the bow or stern to turn it. Rubber fenders transfer the force without a collision penalty or a bouncy impact.

Tug contact with structures or moored traffic carries the same penalties as main-ship contact. History labels each run's mode; the best score remains shared across modes. Shared challenges include the completed run's mode.

## Controls

- Arrow Up: engine ahead
- Arrow Down: engine astern
- Arrow Left / Right: rudder
- W / S: tug engine ahead / astern (Tug assist)
- A / D: tug rudder (Tug assist)
- Q / E: tug port / starboard thrusters; slide sideways relative to its heading
- Space: attach / release the towline when nearby (press once per action)
- R: restart the run with a newly generated harbor
- Escape: open the menu / abandon the current run

The vessel has inertia, lateral drag, delayed steering response and weaker reverse thrust. Start slowing earlier than you think you need to.

## Procedural harbor

Every docking builds a new map in JavaScript. The generator varies:

- target quay side and berth position
- quay depth
- berth dimensions
- number, position and length of secondary piers
- container stacks and colors
- gantry crane positions
- navigation lights and buoy placement
- ship spawn position and initial heading
- 4–7 moored vessels in several size classes (tugs, pilot boats, coasters, ferries and cargo ships)

The berth, its straight-in approach corridor and the player spawn area are protected from procedural traffic. Moored vessels are also checked against land and one another, so generated layouts remain playable.

## Score storage

Completed runs are stored in the `dock_scores_v1` cookie. It contains versioned JSON with:

- `best` — best completed score
- `history` — the 20 latest completed runs (`score`, `docks`, timestamp, mode)

The cookie expires one year after the latest completed run. If cookies are blocked, the game remains fully playable and shows a short persistence warning.

## Run locally

Cookies are more reliable over HTTP/HTTPS than `file://`. From the project directory, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

The folder can be deployed directly to GitHub Pages.

## Branding

The MoD-IT logo in the upper-left corner links to Grzegorz Byrka's LinkedIn profile. The original logo artwork is in `assets/mod-it.jpg` and is visually adapted to the dark interface with CSS.

## Files

- `index.html` — interface and HUD
- `style.css` — responsive dark maritime presentation
- `game.js` — procedural generation, ship physics, collisions, scoring, particles and rendering
- `assets/mod-it.jpg` — branding asset
- `assets/dock-social.png` — 1200×630 Open Graph / social sharing artwork
- `README.md` — this file


## Challenge links and Facebook sharing

Completed runs expose a **Share score on Facebook** button. It:

- creates a challenge URL using the current score, e.g. `?c=...`
- opens Facebook's standard share dialog with that public URL
- copies a short score message to the clipboard for easy pasting into the Facebook post
- shows the decoded target in-game to anyone opening the challenge link
- announces when the target score has been beaten

The score in the URL is not stored as a plain number. It is packed with a random salt and checksum, encrypted as a 64-bit XTEA block with a local 128-bit key, and then Base64URL encoded. This is deliberately **reversible client-side obfuscation**, not security: because the game is entirely static JavaScript, a determined user can inspect the source and recover the key. It is intended to keep the score from being immediately obvious in a copied URL, not to provide anti-cheat protection.

### Facebook / Open Graph image

`index.html` contains Open Graph and Twitter card metadata pointing at:

`https://gbyrka.github.io/dock/assets/dock-social.png`

The included image is exactly **1200 × 630 px**, suitable for a large social preview. The fallback public URL used when testing from `file://` is `https://gbyrka.github.io/dock/`. There is intentionally no fixed `og:url`: this lets Facebook keep the `?c=...` challenge token in the shared address. If the game is published under another repository/path/domain, update `og:image`, `twitter:image`, `image_src`, and `PUBLIC_URL` in `game.js`.

Facebook may cache a preview after the URL is shared for the first time. If you replace `dock-social.png` later, Facebook's Sharing Debugger can be used to request a fresh scrape.
