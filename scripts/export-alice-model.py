"""Export the supplied Blender scene for the location map without changing it.

Run with Blender in background mode, with --disable-autoexec, followed by:
  --python scripts/export-alice-model.py -- /absolute/path/to/output.glb

Blender coordinates remain in metres: X across the facade, +Y toward the rear,
Z up. The glTF exporter converts these to X, Y up, -Z toward the rear.
"""

import bpy
import json
import sys
from pathlib import Path


output = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
output.parent.mkdir(parents=True, exist_ok=True)

# The 500 m studio lawn and individual grass blades are render scenery, not
# surveyed site geometry. Keep the architectural model and planted borders.
omit = {
    "Garden lawn",
    "Lawn | individual editable blades",
    "Foreground lawn | extended blades",
    "Rear lawn | individual blades",
    "Blok B | Gazon | losse grassprieten",
}
source_objects = [
    obj for obj in bpy.context.scene.objects
    if obj.type == "MESH" and not obj.hide_render and obj.name not in omit
]

# Freeze evaluated modifiers before joining, so roof details and bevels survive.
depsgraph = bpy.context.evaluated_depsgraph_get()
export_scene = bpy.data.scenes.new("Alice Buyssehof web export")
for obj in source_objects:
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
    clone = bpy.data.objects.new(obj.name, mesh)
    clone.matrix_world = obj.matrix_world.copy()
    export_scene.collection.objects.link(clone)

bpy.context.window.scene = export_scene

# Leaf canopies are made for close-up rendering. Reduce those meshes only;
# facades, roof tiles, windows and garden walls retain their full geometry.
for obj in list(export_scene.objects):
    if any(word in obj.name.lower() for word in ("leaf canopy", "leaf mesh", "hornbeam hedge", "achterhaag", "zijhaag")):
        modifier = obj.modifiers.new("Map foliage detail", "DECIMATE")
        modifier.ratio = 0.18
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)

# GLB has no Cycles procedural shaders. Retain their base colours and roughness;
# map glass uses an opaque reflection tint to avoid expensive transmission passes.
for material in bpy.data.materials:
    if not material.use_nodes:
        continue
    shader = next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not shader:
        continue
    # glTF cannot evaluate Cycles noise/ramp graphs and would export white.
    # Each source material stores its intended colour in the socket default.
    for socket in shader.inputs:
        for link in list(socket.links):
            material.node_tree.links.remove(link)
    if material.name.endswith("Glass | architectural clear"):
        shader.inputs["Base Color"].default_value = (0.15, 0.21, 0.22, 1)
        shader.inputs["Transmission Weight"].default_value = 0
        shader.inputs["Metallic"].default_value = 0.25
        shader.inputs["Roughness"].default_value = 0.3

bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = next(iter(export_scene.objects))
bpy.ops.object.join()
merged = bpy.context.object
merged.name = "Alice Buyssehof | architecture and gardens"
# Export one mesh with a primitive per material instead of 1,800 draw calls.
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.export_scene.gltf(
    filepath=str(output),
    export_format="GLB",
    use_selection=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
    export_extras=False,
    export_texcoords=False,
    export_normals=True,
    export_yup=True,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    export_draco_position_quantization=16,
    export_draco_normal_quantization=10,
)
print(json.dumps({
    "output": str(output),
    "bytes": output.stat().st_size,
    "source_objects": len(source_objects),
    "vertices": len(merged.data.vertices),
    "materials": len(merged.data.materials),
    "units": "metres",
    "omitted_scenery": sorted(omit),
}))
