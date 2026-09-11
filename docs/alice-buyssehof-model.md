# Alice Buyssehof project model

The `/alice-buyssehof` map includes two built-in models:

- **Alice Buyssehof**: `public/models/alice-buyssehof.glb`, the earlier model.
- **Alice Buyssehof Compleet**: `public/models/alice-buyssehof-compleet.glb`,
  exported from the supplied `Alice-Buyssehof-Compleet.blend`, including Blok B.

Both load automatically and are available even when browser storage is blocked.
The complete project is added beside the earlier model as a provisional preview;
use its checkbox and **Model bewerken** to show, hide, move or rotate it separately.
Built-in models are deployed with the site; uploaded models remain in the browser.

The MapLibre custom 3D layer uses the map camera and depth buffer, a local
Draco decoder, and the installed Three.js version. Each model has its own
visibility control and placement; 2D hides all project models.

## Upload another Blender model

Choose **Modellen uploaden** and select one or more self-contained `.glb` files,
up to 50 MB each.
In Blender, use **File → Export → glTF 2.0 → glTF Binary (.glb)**. The upload
panel includes these instructions; native `.blend` files must be exported first.

All checked models remain visible together, including while another is selected
or being positioned. **Model bewerken** selects the model whose placement controls
are active; it does not replace or reload the other scenes. Each model has its
own visibility checkbox, and **Alles in beeld** fits the visible models in the
viewport. Multiple files can be uploaded at once; an invalid file does not prevent
the other files from being added.

Uploaded geometry and the complete built-in project are centred horizontally
and grounded using its bounding box, with its metric dimensions preserved.
The placement pin for an upload sits at that ground centre. Each model has
its own saved coordinates and rotation; Alice Buyssehof keeps its original
placement storage key and facade-origin anchor. New uploads without a saved
placement are provisionally spaced beside existing geometry with an 8 m gap,
so they can be seen separately. This initial layout is retained in browser
placement storage when available; it is not a verified geographic placement.

Models, individual visibility settings and the last selected model are retained
in IndexedDB in this browser. All stored models are restored on reload; libraries
saved by the previous single-model version are supported without a migration.
Files are not sent to a server or made available to other visitors.
If browser storage is unavailable or full, an uploaded model remains usable for
the current session and the interface explains that it could not be retained.
The remove button beside an upload removes only that model. The other models,
their visibility and their placements are retained. The source file on your
computer is unaffected.

An invalid or unsupported upload leaves all existing models and placements intact.
Container validation rejects malformed GLB headers and chunk sizes, and refuses
external resource URLs. Model decoding also restricts resource loads to embedded
data and blob URLs. Export textures with the geometry in the GLB file.

## Place the project on the map

Choose **Verplaats het project** to focus the model and start editing. Drag
the pin, or click/tap elsewhere on the map. For the earlier model the pin is at
the front facade; for the complete project and uploads it is at the ground centre.
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

The project layer uses one WebGL renderer with a scene and transform per model.
Decodes are queued to limit peak memory use. Switching the editing selection
reuses already-loaded geometry. Leaving the page disposes all model resources;
removing one model disposes only its own geometry, materials and textures. Map
recovery restores a snapshot of all loaded models, placements and visibility.

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

For the complete model, use the same script with the supplied source file:

```sh
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --disable-autoexec /path/to/Alice-Buyssehof-Compleet.blend -t 4 \
  --python scripts/export-alice-model.py -- \
  "$PWD/public/models/alice-buyssehof-compleet.glb"
```

The complete export is 8,471,848 bytes (8.5 MB), combining 2,778 source mesh
objects into one mesh with 82 material primitives. It includes both building
blocks with their relative arrangement from Blender preserved. Source SHA-256:
`33e8765cba8f33e6089bab74553479858861f6307a1e92b725700d64e90142ff`.

The script does not save or modify the source `.blend`. It preserves evaluated
architectural geometry, simplifies dense foliage, excludes the 500 m studio
lawn and individual lawn blades, retains material base colours, and substitutes
a reflection tint for glass transmission. Cycles procedural texture detail is
not baked. The earlier export combines approximately 1,800 separate objects into
one joined mesh with 74 material primitives, producing a Draco GLB of about 6.5 MB.

`npm run dev:web` and `npm run build:vercel` copy the matching decoder assets
into the ignored `public/gent-map/draco/` directory. The GLB itself is tracked
under `public/models/`, outside that ignored directory.

Rendering follows the [MapLibre custom 3D layer API](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/).
