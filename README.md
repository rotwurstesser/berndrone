# Bern Drone

Small browser prototype for third-person drone flight over streamed Swiss 3D terrain and buildings.

## What it does

- streams terrain from `3d.geo.admin.ch`
- streams Swiss buildings as Cesium 3D Tiles
- uses swisstopo imagery for ground texture
- gives you a lightweight third-person drone controller with orbit camera
- keeps the world load dynamic instead of trying to preload Bern into memory

## Run it locally

This repo is static, so any small local web server works.

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Controls

- `W A S D`: fly relative to the camera
- `ArrowUp / ArrowDown`: rise and descend
- `Shift`: turbo
- `Space`: brake
- Drag: orbit and tilt camera
- Mouse wheel: zoom

Forward flight now follows the camera pitch, so looking down makes the drone dive and looking up makes it climb.

## Notes

- The prototype is optimized for desktop keyboard and mouse first.
- It depends on swisstopo public services being reachable.
- The world data is streamed directly from official endpoints, so there are no local terrain packages or secrets in this repo.

## Data sources

- Terrain service: `https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/layer.json`
- Buildings tileset: `https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json`
- Imagery: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage-product/default/current/3857/{z}/{x}/{y}.jpeg`
