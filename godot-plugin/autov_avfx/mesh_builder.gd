extends RefCounted
## Narrow, bounds-checked reader for the geometry-only GLBs written by AutoV.
## Retains original numeric UVs and does not run the general glTF importer.
const MAX_VERTICES := 1000000
var error := ""

func _fail(message: String):
	error = message
	return null

func _accessor(gltf: Dictionary, binary: PackedByteArray, index: int):
	if index < 0 or index >= gltf.accessors.size(): return _fail("Invalid accessor index")
	var a: Dictionary = gltf.accessors[index]
	var sizes := {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
	var items: int = sizes.get(a.get("type", ""), 0)
	var count: int = int(a.get("count", 0))
	var component: int = int(a.get("componentType", 0))
	var view_index: int = int(a.get("bufferView", -1))
	if count <= 0 or count > MAX_VERTICES * 6 or items == 0 or not component in [5125, 5126]: return _fail("Unsupported accessor format")
	if a.has("sparse") or a.get("normalized", false): return _fail("Sparse/normalized accessors not supported")
	if view_index < 0 or view_index >= gltf.bufferViews.size(): return _fail("Invalid buffer view")
	var view: Dictionary = gltf.bufferViews[view_index]
	var offset: int = int(view.get("byteOffset", 0)) + int(a.get("byteOffset", 0))
	var stride: int = int(view.get("byteStride", items * 4))
	var end: int = offset + (count - 1) * stride + items * 4
	if view.get("buffer", -1) != 0 or offset < 0 or stride < items * 4 or end > binary.size() or end > int(view.get("byteOffset", 0)) + int(view.get("byteLength", 0)):
		return _fail("Accessor exceeds buffer")
	var values := PackedFloat64Array()
	values.resize(count * items)
	for i in count:
		for k in items:
			var value: float = binary.decode_float(offset + i * stride + k * 4) if component == 5126 else float(binary.decode_u32(offset + i * stride + k * 4))
			if not is_finite(value): return _fail("Non-finite mesh data")
			values[i * items + k] = value
	return {"values": values, "items": items, "count": count}

func read_glb(bytes: PackedByteArray):
	error = ""
	if bytes.size() < 28 or bytes.decode_u32(0) != 0x46546c67 or bytes.decode_u32(4) != 2 or bytes.decode_u32(8) != bytes.size(): return _fail("Invalid GLB header")
	var json_size := bytes.decode_u32(12)
	var bin_header := 20 + json_size
	if bin_header + 8 > bytes.size() or bytes.decode_u32(16) != 0x4e4f534a or bytes.decode_u32(bin_header + 4) != 0x004e4942: return _fail("Invalid GLB chunks")
	if bin_header + 8 + bytes.decode_u32(bin_header) != bytes.size(): return _fail("Invalid binary chunk length")
	var gltf = JSON.parse_string(bytes.slice(20, bin_header).get_string_from_utf8())
	if not gltf is Dictionary or not gltf.get("accessors") is Array or not gltf.get("bufferViews") is Array or not gltf.get("meshes") is Array: return _fail("Invalid glTF JSON")
	if gltf.meshes.size() != 1 or gltf.meshes[0].get("primitives", []).size() != 1: return _fail("Expected one mesh primitive")
	var primitive: Dictionary = gltf.meshes[0].primitives[0]
	if primitive.get("mode", 4) != 4 or not primitive.get("attributes") is Dictionary: return _fail("Expected triangles")
	var binary := bytes.slice(bin_header + 8)
	var attributes := {}
	for name in primitive.attributes:
		if not name in ["POSITION", "NORMAL", "TEXCOORD_0"]: return _fail("Unsupported surface vertex attribute: " + name)
		var a = _accessor(gltf, binary, int(primitive.attributes[name]))
		if a == null: return null
		if a.items != (2 if name == "TEXCOORD_0" else 3): return _fail("Invalid attribute width")
		attributes[name] = a
	if not attributes.has("POSITION"): return _fail("Missing positions")
	var count: int = attributes.POSITION.count
	if count > MAX_VERTICES: return _fail("Vertex budget exceeded")
	for a in attributes.values():
		if a.count != count: return _fail("Attribute counts differ")
	var indices := PackedInt32Array()
	if primitive.has("indices"):
		var a = _accessor(gltf, binary, int(primitive.indices))
		if a == null: return null
		if a.items != 1: return _fail("Invalid indices")
		for value in a.values:
			if value < 0 or value >= count or value != floor(value): return _fail("Index out of bounds")
			indices.append(int(value))
	else:
		for i in count: indices.append(i)
	if indices.size() % 3 != 0: return _fail("Non-triangle index count")
	return {"attributes": attributes, "indices": indices, "count": count}

func build(base: Dictionary, instances = null):
	var count: int = int(instances.get("count", 0)) if instances != null else 1
	if count < 1 or count > 60000 or base.count * count > MAX_VERTICES: return _fail("Expanded particle vertex budget exceeded")
	var positions := PackedVector3Array()
	var normals := PackedVector3Array()
	var uv := PackedVector2Array()
	var uv2 := PackedVector2Array()
	var indices := PackedInt32Array()
	var total: int = base.count * count
	positions.resize(total); normals.resize(total); uv.resize(total); uv2.resize(total)
	var attrs: Dictionary = base.attributes
	for instance in count:
		for vertex in int(base.count):
			var dst: int = instance * base.count + vertex
			var p: PackedFloat64Array = attrs.POSITION.values
			positions[dst] = Vector3(p[vertex * 3], p[vertex * 3 + 1], p[vertex * 3 + 2])
			if attrs.has("NORMAL"):
				var n: PackedFloat64Array = attrs.NORMAL.values
				normals[dst] = Vector3(n[vertex * 3], n[vertex * 3 + 1], n[vertex * 3 + 2])
			else: normals[dst] = Vector3(0, 0, 1)
			if attrs.has("TEXCOORD_0"):
				var t: PackedFloat64Array = attrs.TEXCOORD_0.values
				uv[dst] = Vector2(t[vertex * 2], t[vertex * 2 + 1])
			uv2[dst] = Vector2(instance, 0)
		for i in range(0, base.indices.size(), 3):
			# Godot uses clockwise front faces, source GLB uses counterclockwise.
			indices.append(instance * base.count + base.indices[i])
			indices.append(instance * base.count + base.indices[i + 2])
			indices.append(instance * base.count + base.indices[i + 1])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = positions; arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uv; arrays[Mesh.ARRAY_TEX_UV2] = uv2
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	# Vertex programs can move far outside their base card/sphere bounds.
	mesh.custom_aabb = AABB(Vector3(-1000, -1000, -1000), Vector3(2000, 2000, 2000))
	return mesh

func instance_texture(instances: Dictionary):
	var count: int = int(instances.get("count", 0))
	if count < 1 or count > 60000 or not instances.get("attributes") is Dictionary: return _fail("Invalid particle instance table")
	var names := ["aSeed", "aExtra", "aExtra2", "aIndex", "aSrcPos", "aSrcDir", "aEvent", "aSub"]
	var widths := [4, 4, 4, 1, 3, 3, 4, 1]
	var height: int = ceili(count * 8.0 / 1024.0)
	var packed := PackedFloat32Array()
	packed.resize(1024 * height * 4)
	for column in names.size():
		var attr = instances.attributes.get(names[column])
		if not attr is Dictionary or attr.get("count") != count or attr.get("itemSize") != widths[column] or not attr.get("values") is Array:
			return _fail("Missing/invalid instance attribute: " + names[column])
		if attr.values.size() != count * widths[column]: return _fail("Instance data length mismatch")
		for i in count:
			for k in int(widths[column]):
				var value = attr.values[i * widths[column] + k]
				if not (value is float or value is int) or not is_finite(value): return _fail("Invalid instance value")
				packed[(i * 8 + column) * 4 + k] = value
	var image := Image.create_from_data(1024, height, false, Image.FORMAT_RGBAF, packed.to_byte_array())
	return ImageTexture.create_from_image(image)
