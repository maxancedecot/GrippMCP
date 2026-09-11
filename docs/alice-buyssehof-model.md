# Alice Buyssehof project model

The `/alice-buyssehof` map loads `public/models/alice-buyssehof.glb` as a
MapLibre custom 3D layer. It uses the map camera and depth buffer, a local
Draco decoder, and the installed Three.js version. The model has its own
visibility control, loading/retry state and focus button; 2D hides it.

## Upload another Blender model

Choose **Model uploaden** and select a self-contained `.glb` file up to 50 MB.
In Blender, use **File → Export → glTF 2.0 → glTF Binary (.glb)**. The upload
panel includes these instructions; native `.blend` files must be exported first.

The **3D-model** selector switches between Alice Buyssehof and your uploads.
One project model is shown at a time. Uploaded geometry is centred horizontally
and grounded using its bounding box, with its metric dimensions preserved.
The placement pin for an upload sits at that ground centre. Each model has
its own saved coordinates and rotation; Alice Buyssehof keeps its original
placement storage key and facade-origin anchor.

Models and the last selected model are retained in IndexedDB in this browser.
Files are not sent to a server or made available to other visitors.
If browser storage is unavailable or full, an uploaded model remains usable for
the current session and the interface explains that it could not be retained.
**Verwijder dit model** removes an upload from the browser library and returns
to Alice Buyssehof. The source file on your computer is unaffected.

An invalid or unsupported upload leaves the previous model and placement intact.
Container validation rejects malformed GLB headers and chunk sizes, and refuses
external resource URLs. Model decoding also restricts resource loads to embedded
data and blob URLs. Export textures with the geometry in the GLB file.

## Place the project on the map

Choose **Verplaats het project** to focus the model and start editing. Drag
the pin at the centre of the front facade, or click/tap elsewhere on the map.
The selected pin can also be moved with the arrow keys (Shift moves it faster).
Use **Richting voorgevel** to rotate the building; 0° is north, 90° east,
180° south and 270° west. Geometry updates immediately without reloading the GLB.

**Positie opslaan** retains the coordinates and bearing in this browser's local
storage. It does not publish a shared placement or modify the Blender source.
**Annuleren** restores the placement from before editing. **Terug naar beginpositie**
previews the original anchor; save to keep that reset or cancel to discard it.
Invalid saved values are rejected, and storage failures keep the draft visible
with an actionable message. Movement is limited to the map's Nevele bounds.

While editing, the model stays visible in 3D and the landmark pins are hidden.
Normal map navigation, landmark visibility and 2D controls return after editing.
The focus button always follows the current placement, including after a reload.

## Placement still needs a site reference

`app/gent/project-model.ts` contains the default placement parameters. The default
anchor is the existing street centre **for preview only**. Neither the parcel
nor the facade bearing has been confirmed. A browser-saved placement is a user
adjustment, not geographic verification. Do not describe it as a geographically verified
integration until a site plan or confirmed coordinates and direction are supplied.

- `coordinates`: WGS84 longitude/latitude of Blender's `(0, 0, 0)` origin,
  at the centre of the front facade, rather than the garden or bounding-box centre.
- `facadeBearing`: direction the front facade faces, clockwise from north.
  Blender's front faces `-Y`; `180` leaves its original orientation unchanged.
- `altitude`: metres above the flat map, with a small ground clearance.
- `scale`: `1` retains the Blender dimensions in metres.
- `placementConfirmed`: currently `false`.

After confirmation, check the site against the surrounding map buildings;
the unconfirmed preview deliberately does not remove existing map footprints.

The supplied scene metadata describes a visual reconstruction from exterior
renders with inferred dimensions, not a measured survey. Metric scene units
therefore do not establish dimensional accuracy.

## Reproduce the web asset

```sh
/Applications/Blender.app/Contents/MacOS/Blender \
  -b /Users/maxancedecot/Documents/Alice-Buyssehof-Rear-Completed.blend \
  --disable-autoexec -t 4 \
  --python scripts/export-alice-model.py -- \
  "$PWD/public/models/alice-buyssehof.glb"
```

The script does not save or modify the source `.blend`. It preserves evaluated
architectural geometry, simplifies dense foliage, excludes the 500 m studio
lawn and individual lawn blades, retains material base colours, and substitutes
a reflection tint for glass transmission. Cycles procedural texture detail is
not baked. One joined mesh with 74 material primitives replaces approximately
1,800 separate objects. The resulting Draco GLB is approximately 6.5 MB.

`npm run dev:web` and `npm run build:vercel` copy the matching decoder assets
into the ignored `public/gent-map/draco/` directory. The GLB itself is tracked
under `public/models/`, outside that ignored directory.

Rendering follows the [MapLibre custom 3D layer API](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/).
