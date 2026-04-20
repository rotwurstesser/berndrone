const {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  CesiumTerrainProvider,
  ClockRange,
  Color,
  defined,
  HeadingPitchRange,
  HeadingPitchRoll,
  JulianDate,
  Math: CesiumMath,
  Matrix4,
  Rectangle,
  Transforms,
  UrlTemplateImageryProvider,
  Viewer,
  WebMercatorTilingScheme,
} = Cesium;

const LOCATIONS = [
  {
    id: "bern-old-town",
    label: "Bern Old Town",
    longitude: 7.44744,
    latitude: 46.94809,
    altitude: 160,
    headingDeg: 30,
  },
  {
    id: "gurten",
    label: "Bern Gurten",
    longitude: 7.41933,
    latitude: 46.92526,
    altitude: 170,
    headingDeg: 18,
  },
  {
    id: "zurich-lake",
    label: "Zurich Lake",
    longitude: 8.54169,
    latitude: 47.36667,
    altitude: 180,
    headingDeg: 24,
  },
  {
    id: "jegenstorf",
    label: "Jegenstorf",
    longitude: 7.50588,
    latitude: 47.04869,
    altitude: 170,
    headingDeg: 18,
  },
  {
    id: "basel-old-town",
    label: "Basel Old Town",
    longitude: 7.58858,
    latitude: 47.55673,
    altitude: 190,
    headingDeg: 30,
  },
  {
    id: "geneva-center",
    label: "Geneva Center",
    longitude: 6.14657,
    latitude: 46.20176,
    altitude: 190,
    headingDeg: 28,
  },
  {
    id: "gumligen",
    label: "Gümligen",
    longitude: 7.50379,
    latitude: 46.93489,
    altitude: 155,
    headingDeg: 24,
  },
];

const DEFAULT_CLEARANCE_METERS = 14;
const BASE_SPEED = 42;
const BOOST_MULTIPLIER = 4.8;
const ASCENT_RATE = 24;
const CAMERA_RANGE = { min: 12, max: 80 };
const DISPLAY_PITCH_LIMIT = CesiumMath.toRadians(18);
const DISPLAY_ROLL_LIMIT = CesiumMath.toRadians(26);

const terrainServiceUrl =
  "https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1";
const swissImageUrl =
  "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage-product/default/current/3857/{z}/{x}/{y}.jpeg";
const swissBuildingsUrl =
  "https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json";
const streetIdentifyUrl =
  "https://api3.geo.admin.ch/rest/services/ech/MapServer/identify";
const swissBounds = Rectangle.fromDegrees(5.95, 45.75, 10.7, 47.95);

const streamStatus = document.querySelector("#stream-status");
const streetReadout = document.querySelector("#street-readout");
const altitudeReadout = document.querySelector("#altitude-readout");
const speedReadout = document.querySelector("#speed-readout");
const locationSelect = document.querySelector("#location-select");
const resetFlightButton = document.querySelector("#reset-flight");
const hudPanel = document.querySelector("#hud-panel");
const hudToggle = document.querySelector("#hud-toggle");

const keyState = new Set();

const droneState = {
  position: null,
  velocityLocal: new Cartesian3(0, 0, 0),
  heading: CesiumMath.toRadians(30),
  cameraOrbit: 0,
  cameraPitch: CesiumMath.toRadians(-22),
  cameraDistance: 26,
  displayPitch: 0,
  displayRoll: 0,
};

let viewer;
let droneEntity;
let terrainProvider;
let streetLookupState = {
  lastLookupAt: 0,
  lastLongitude: null,
  lastLatitude: null,
  requestId: 0,
};

bootstrap().catch((error) => {
  console.error(error);
  streamStatus.textContent = "World failed to load";
});

async function bootstrap() {
  populateLocations();
  terrainProvider = await CesiumTerrainProvider.fromUrl(terrainServiceUrl);

  viewer = new Viewer("cesium-root", {
    terrainProvider,
    animation: false,
    baseLayerPicker: false,
    baseLayer: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    infoBox: false,
    skyAtmosphere: false,
    scene3DOnly: true,
    shouldAnimate: true,
  });

  viewer.clock.clockRange = ClockRange.UNBOUNDED;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.maximumScreenSpaceError = 1.6;
  viewer.scene.requestRenderMode = false;

  const controls = viewer.scene.screenSpaceCameraController;
  controls.enableRotate = false;
  controls.enableTranslate = false;
  controls.enableZoom = false;
  controls.enableTilt = false;
  controls.enableLook = false;

  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.addImageryProvider(
    new UrlTemplateImageryProvider({
      url: swissImageUrl,
      tilingScheme: new WebMercatorTilingScheme(),
      rectangle: swissBounds,
      minimumLevel: 7,
      maximumLevel: 19,
      credit: "Contains modified Copernicus Sentinel data and swisstopo imagery",
    }),
  );

  const buildings = await Cesium3DTileset.fromUrl(swissBuildingsUrl, {
    skipLevelOfDetail: true,
    maximumScreenSpaceError: 8,
    dynamicScreenSpaceError: true,
    preloadWhenHidden: false,
    cullRequestsWhileMoving: true,
  });
  viewer.scene.primitives.add(buildings);

  const initialPreset = LOCATIONS[0];
  await placeDrone(initialPreset);
  installInputHandlers(viewer.canvas);
  installUiHandlers();
  viewer.scene.preRender.addEventListener(updateFrame);

  streamStatus.textContent = "Streaming terrain and buildings";
}

function populateLocations() {
  for (const location of LOCATIONS) {
    const option = document.createElement("option");
    option.value = location.id;
    option.textContent = location.label;
    locationSelect.append(option);
  }
}

function installUiHandlers() {
  hudToggle.addEventListener("click", () => {
    const nextExpanded = hudToggle.getAttribute("aria-expanded") !== "true";
    hudToggle.setAttribute("aria-expanded", String(nextExpanded));
    hudToggle.textContent = nextExpanded ? "Hide Settings" : "Show Settings";
    hudPanel.classList.toggle("is-hidden", !nextExpanded);
  });

  locationSelect.addEventListener("change", async (event) => {
    const preset = LOCATIONS.find(
      (location) => location.id === event.target.value,
    );

    if (!preset) {
      return;
    }

    streamStatus.textContent = `Jumping to ${preset.label}`;
    await placeDrone(preset);
    streamStatus.textContent = "Streaming terrain and buildings";
  });

  resetFlightButton.addEventListener("click", async () => {
    const preset = LOCATIONS.find(
      (location) => location.id === locationSelect.value,
    ) ?? LOCATIONS[0];
    await placeDrone(preset);
  });
}

function installInputHandlers(canvas) {
  window.addEventListener("blur", () => {
    keyState.clear();
  });

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLSelectElement) {
      return;
    }

    keyState.add(event.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
      event.preventDefault();
    }
  });

  window.addEventListener("keyup", (event) => {
    keyState.delete(event.code);
  });

  let dragging = false;
  let last = new Cartesian2();

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    last = new Cartesian2(event.clientX, event.clientY);
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointerup", (event) => {
    dragging = false;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }

    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    last = new Cartesian2(event.clientX, event.clientY);

    droneState.cameraOrbit -= dx * 0.0055;
    droneState.cameraPitch = CesiumMath.clamp(
      droneState.cameraPitch - dy * 0.0042,
      CesiumMath.toRadians(-75),
      CesiumMath.toRadians(55),
    );
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      droneState.cameraDistance = CesiumMath.clamp(
        droneState.cameraDistance + event.deltaY * 0.02,
        CAMERA_RANGE.min,
        CAMERA_RANGE.max,
      );
    },
    { passive: false },
  );
}

async function placeDrone(preset) {
  keyState.clear();
  const terrainHeight = await sampleTerrainHeight(
    preset.longitude,
    preset.latitude,
    540,
  );
  const worldPosition = Cartesian3.fromDegrees(
    preset.longitude,
    preset.latitude,
    terrainHeight + preset.altitude,
  );

  droneState.position = worldPosition;
  droneState.velocityLocal = new Cartesian3(0, 0, 0);
  droneState.heading = CesiumMath.toRadians(preset.headingDeg);
  droneState.cameraOrbit = CesiumMath.toRadians(preset.headingDeg);
  droneState.cameraPitch = CesiumMath.toRadians(-22);
  droneState.cameraDistance = 26;
  droneState.displayPitch = 0;
  droneState.displayRoll = 0;
  streetLookupState = {
    lastLookupAt: 0,
    lastLongitude: null,
    lastLatitude: null,
    requestId: 0,
  };
  streetReadout.textContent = "Looking up...";

  if (!droneEntity) {
    droneEntity = viewer.entities.add({
      position: new Cesium.CallbackProperty(() => droneState.position, false),
      orientation: new Cesium.CallbackProperty(() => {
        return Transforms.headingPitchRollQuaternion(
          droneState.position,
          new HeadingPitchRoll(
            droneState.heading,
            droneState.displayPitch,
            droneState.displayRoll,
          ),
        );
      }, false),
      box: {
        dimensions: new Cartesian3(3.8, 1.1, 1.4),
        material: Color.fromCssColorString("#7ee081"),
        outline: true,
        outlineColor: Color.fromCssColorString("#0a1119"),
      },
    });
  }

  locationSelect.value = preset.id;
  updateCamera();
}

async function sampleTerrainHeight(longitude, latitude, fallbackHeight) {
  try {
    const [sample] = await Cesium.sampleTerrainMostDetailed(terrainProvider, [
      Cartographic.fromDegrees(longitude, latitude),
    ]);

    return defined(sample.height) ? sample.height : fallbackHeight;
  } catch (error) {
    console.warn("Terrain sample failed, falling back to a safe altitude.", error);
    return fallbackHeight;
  }
}

function updateFrame(scene, time) {
  if (!droneState.position) {
    return;
  }

  const dt = Math.min(JulianDate.secondsDifference(time, updateFrame.previousTime ?? time), 0.05);
  updateFrame.previousTime = JulianDate.clone(time, updateFrame.previousTime);

  if (dt <= 0) {
    updateCamera();
    return;
  }

  const boost = keyState.has("ShiftLeft") || keyState.has("ShiftRight");
  const speed = BASE_SPEED * (boost ? BOOST_MULTIPLIER : 1);

  let forward = 0;
  let strafe = 0;
  let lift = 0;
  if (keyState.has("KeyW")) forward += 1;
  if (keyState.has("KeyS")) forward -= 1;
  if (keyState.has("KeyD")) strafe += 1;
  if (keyState.has("KeyA")) strafe -= 1;
  if (keyState.has("ArrowUp")) lift += 1;
  if (keyState.has("ArrowDown")) lift -= 1;

  const controlHeading = droneState.cameraOrbit;
  const forwardVector = new Cartesian3(
    -Math.sin(controlHeading),
    -Math.cos(controlHeading),
    0,
  );
  const rightVector = new Cartesian3(
    -Math.sin(controlHeading + CesiumMath.PI_OVER_TWO),
    -Math.cos(controlHeading + CesiumMath.PI_OVER_TWO),
    0,
  );

  const desiredLocalVelocity = new Cartesian3(
    rightVector.x * strafe * speed + forwardVector.x * forward * speed,
    rightVector.y * strafe * speed + forwardVector.y * forward * speed,
    forward * speed * Math.sin(droneState.cameraPitch) * 0.72 +
      lift * ASCENT_RATE,
  );

  if (keyState.has("Space")) {
    Cartesian3.multiplyByScalar(droneState.velocityLocal, 0.84, droneState.velocityLocal);
  } else {
    const lerpFactor = 1 - Math.exp(-dt * 8);
    droneState.velocityLocal.x +=
      (desiredLocalVelocity.x - droneState.velocityLocal.x) * lerpFactor;
    droneState.velocityLocal.y +=
      (desiredLocalVelocity.y - droneState.velocityLocal.y) * lerpFactor;
    droneState.velocityLocal.z +=
      (desiredLocalVelocity.z - droneState.velocityLocal.z) * lerpFactor;
  }

  const targetHeading = Math.atan2(-forwardVector.x, -forwardVector.y);
  droneState.heading = targetHeading;

  const targetDisplayPitch = CesiumMath.clamp(
    -forward * CesiumMath.toRadians(10) +
      (droneState.velocityLocal.z / Math.max(speed, ASCENT_RATE)) *
        CesiumMath.toRadians(12),
    -DISPLAY_PITCH_LIMIT,
    DISPLAY_PITCH_LIMIT,
  );
  const targetDisplayRoll = CesiumMath.clamp(
    -strafe * CesiumMath.toRadians(15),
    -DISPLAY_ROLL_LIMIT,
    DISPLAY_ROLL_LIMIT,
  );
  const attitudeLerp = 1 - Math.exp(-dt * 8);
  droneState.displayPitch +=
    (targetDisplayPitch - droneState.displayPitch) * attitudeLerp;
  droneState.displayRoll +=
    (targetDisplayRoll - droneState.displayRoll) * attitudeLerp;

  const moveEnu = new Cartesian3(
    droneState.velocityLocal.x * dt,
    droneState.velocityLocal.y * dt,
    droneState.velocityLocal.z * dt,
  );
  const worldMove = enuOffsetToWorld(moveEnu, droneState.position);
  const candidate = Cartesian3.add(
    droneState.position,
    worldMove,
    new Cartesian3(),
  );
  const cartographic = Cartographic.fromCartesian(candidate);
  const terrainHeight =
    viewer.scene.globe.getHeight(cartographic) ?? cartographic.height - DEFAULT_CLEARANCE_METERS;
  const minimumHeight = terrainHeight + DEFAULT_CLEARANCE_METERS;

  if (cartographic.height < minimumHeight) {
    cartographic.height = minimumHeight;
    droneState.velocityLocal.z = Math.max(droneState.velocityLocal.z, 0);
  }

  droneState.position = Cartesian3.fromRadians(
    cartographic.longitude,
    cartographic.latitude,
    cartographic.height,
  );

  updateReadouts(cartographic, dt);
  maybeLookupStreet(cartographic);
  updateCamera();
}

function updateCamera() {
  if (!droneState.position) {
    return;
  }

  viewer.camera.lookAt(
    droneState.position,
    new HeadingPitchRange(
      droneState.cameraOrbit + Math.PI,
      droneState.cameraPitch,
      droneState.cameraDistance,
    ),
  );
}

function updateReadouts(cartographic, dt) {
  const terrainHeight = viewer.scene.globe.getHeight(cartographic) ?? 0;
  const clearance = Math.max(0, cartographic.height - terrainHeight);
  const speed = Cartesian3.magnitude(droneState.velocityLocal);

  altitudeReadout.textContent = `${clearance.toFixed(1)} m AGL`;
  speedReadout.textContent = `${speed.toFixed(1)} m/s`;

  if (dt > 0 && speed > 0.4) {
    streamStatus.textContent = "Flying with streamed LOD";
  }
}

function enuOffsetToWorld(localOffset, anchor) {
  const enuFrame = Transforms.eastNorthUpToFixedFrame(anchor);
  return Matrix4.multiplyByPointAsVector(enuFrame, localOffset, new Cartesian3());
}

function maybeLookupStreet(cartographic) {
  const now = performance.now();
  const longitude = CesiumMath.toDegrees(cartographic.longitude);
  const latitude = CesiumMath.toDegrees(cartographic.latitude);
  const movedEnough =
    streetLookupState.lastLongitude === null ||
    Math.abs(longitude - streetLookupState.lastLongitude) > 0.00012 ||
    Math.abs(latitude - streetLookupState.lastLatitude) > 0.00012;
  const waitedEnough = now - streetLookupState.lastLookupAt > 1400;

  if (!movedEnough || !waitedEnough) {
    return;
  }

  streetLookupState.lastLookupAt = now;
  streetLookupState.lastLongitude = longitude;
  streetLookupState.lastLatitude = latitude;
  streetLookupState.requestId += 1;
  const requestId = streetLookupState.requestId;

  lookupStreetName(longitude, latitude)
    .then((streetName) => {
      if (requestId !== streetLookupState.requestId) {
        return;
      }

      streetReadout.textContent = streetName ?? "No street match";
    })
    .catch(() => {
      if (requestId !== streetLookupState.requestId) {
        return;
      }

      streetReadout.textContent = "Street unavailable";
    });
}

async function lookupStreetName(longitude, latitude) {
  const delta = 0.00022;
  const bbox = [
    longitude - delta,
    latitude - delta,
    longitude + delta,
    latitude + delta,
  ].join(",");
  const params = new URLSearchParams({
    geometryType: "esriGeometryEnvelope",
    geometry: bbox,
    imageDisplay: "100,100,96",
    mapExtent: bbox,
    tolerance: "8",
    layers: "all:ch.swisstopo.amtliches-strassenverzeichnis",
    returnGeometry: "false",
    sr: "4326",
    lang: "en",
  });

  const response = await fetch(`${streetIdentifyUrl}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Street lookup failed with ${response.status}`);
  }

  const data = await response.json();
  const streetResult = data.results?.find(
    (result) =>
      result.properties?.stn_label || result.attributes?.stn_label,
  );

  return (
    streetResult?.properties?.stn_label ??
    streetResult?.attributes?.stn_label ??
    null
  );
}
