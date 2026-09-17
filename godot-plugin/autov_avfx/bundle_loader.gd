extends RefCounted
## Strict STORE-ZIP loader: bounded before decompression, no extraction, no
## arbitrary resource paths, no execution of untrusted shaders/scripts.
const Asset = preload("asset.gd")
const Versions = preload("shader_versions.gd")
const MAX_BYTES := 268435456
const MAX_FILES := 4096
const PROGRAMS := ["particle", "surface", "subParticle", "trail", "subTrail", "strip", "sliver", "blob", "crystal", "splash", "ribbon", "wireBurst", "arc", "streak", "sheet", "crescent", "lick"]
var error := ""

func _fail(message: String):
	error = message
	return null

func _safe_path(path: String) -> bool:
	if path.is_empty() or path.begins_with("/") or path.contains("\\") or path.contains(":"):
		return false
	for part in path.split("/"):
		if part == ".." or part == "." or part.is_empty(): return false
	return true

func _json(bytes: PackedByteArray, label: String):
	var parser := JSON.new()
	if parser.parse(bytes.get_string_from_utf8()) != OK:
		return _fail("Invalid JSON in " + label)
	if not parser.data is Dictionary: return _fail("Expected object: " + label)
	return parser.data

func _value_valid(value, definition: Dictionary) -> bool:
	var type: String = definition.get("type", "")
	var components: int = {"float": 1, "int": 1, "vec2": 2, "vec3": 3, "vec4": 4}.get(type, 0)
	if components == 0: return false
	if definition.has("size"):
		if not value is Array or value.size() != int(definition.size) or value.size() > 64: return false
		for row in value:
			if not _value_valid(row, {"type": type}): return false
		return true
	if components == 1:
		return (value is float or value is int) and is_finite(value) and (type != "int" or value == floor(value))
	if not value is Array or value.size() != components: return false
	for item in value:
		if not (item is float or item is int) or not is_finite(item): return false
	return true

func load_bundle(path: String):
	error = ""
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null: return _fail("Cannot open " + path)
	if file.get_length() > MAX_BYTES: return _fail("Bundle exceeds 256 MiB")
	var bytes := file.get_buffer(file.get_length())
	file.close()
	# Validate local headers before allocating individual entry buffers. The
	# current exporter writes only STORE, no encryption, descriptors or ZIP64.
	var declared := {}
	var offset := 0
	var total := 0
	while offset + 30 <= bytes.size() and bytes.decode_u32(offset) == 0x04034b50:
		var flags := bytes.decode_u16(offset + 6)
		var method := bytes.decode_u16(offset + 8)
		var packed := bytes.decode_u32(offset + 18)
		var size := bytes.decode_u32(offset + 22)
		var length := bytes.decode_u16(offset + 26)
		var extra := bytes.decode_u16(offset + 28)
		var start := offset + 30 + length + extra
		if flags != 0 or method != 0 or packed != size or start + size > bytes.size():
			return _fail("Unsupported or truncated ZIP entry (STORE only)")
		var name := bytes.slice(offset + 30, offset + 30 + length).get_string_from_utf8()
		if not _safe_path(name) or declared.has(name): return _fail("Unsafe or duplicate ZIP path")
		declared[name] = size
		total += size
		if total > MAX_BYTES or declared.size() > MAX_FILES: return _fail("Bundle budget exceeded")
		offset = start + size
	if declared.is_empty() or offset + 4 > bytes.size() or bytes.decode_u32(offset) != 0x02014b50:
		return _fail("Missing ZIP directory")
	# Read the validated STORE bodies directly. This avoids trusting conflicting
	# sizes in a hostile central directory and never extracts paths to disk.
	var files := {}
	offset = 0
	while bytes.decode_u32(offset) == 0x04034b50:
		var size := bytes.decode_u32(offset + 22)
		var length := bytes.decode_u16(offset + 26)
		var start := offset + 30 + length + bytes.decode_u16(offset + 28)
		var name := bytes.slice(offset + 30, offset + 30 + length).get_string_from_utf8()
		files[name] = bytes.slice(start, start + size)
		offset = start + size
	if not files.has("avfx.json"): return _fail("Missing avfx.json")
	var manifest = _json(files["avfx.json"], "avfx.json")
	if manifest == null: return null
	if manifest.get("version") != "avfx/0.1": return _fail("Unsupported AVFX version")
	if not manifest.get("files") is Array or not manifest.get("layers") is Array: return _fail("Missing manifest inventory")
	var verified := {"avfx.json": true}
	for entry in manifest.files:
		if not entry is Dictionary: return _fail("Invalid inventory entry")
		var name: String = entry.get("path", "")
		if not files.has(name) or verified.has(name): return _fail("Missing or duplicate inventory path: " + name)
		var data: PackedByteArray = files[name]
		var hash := HashingContext.new()
		hash.start(HashingContext.HASH_SHA256)
		hash.update(data)
		if data.size() != entry.get("bytes", -1) or hash.finish().hex_encode() != entry.get("sha256", ""):
			return _fail("Hash/size mismatch: " + name)
		verified[name] = true
	if verified.size() != files.size(): return _fail("Unlisted bundle files")
	for program in manifest.get("programs", {}):
		if not Versions.EXPECTED.has(program): return _fail("Unsupported shader program: " + program)
		var references: Dictionary = manifest.programs[program]
		for stage in ["vertex", "fragment"]:
			var name: String = references.get(stage, "")
			if not files.has(name): return _fail("Missing shader reference")
			var hash := HashingContext.new()
			hash.start(HashingContext.HASH_SHA256)
			hash.update(files[name])
			if hash.finish().hex_encode() != Versions.EXPECTED[program][stage]:
				return _fail("Shader revision does not match this adapter: " + program + "/" + stage)
	var duration: float = manifest.get("duration", 0.0)
	if not is_finite(duration) or duration <= 0.0 or duration > 12.0: return _fail("Invalid duration")
	var coords: Dictionary = manifest.get("coordinates", {})
	if coords.get("handedness") != "right" or coords.get("up") != "+Y" or coords.get("units") != "meters":
		return _fail("Unsupported coordinate convention")
	var timeline_path: String = manifest.get("timeline", "")
	if not files.has(timeline_path): return _fail("Missing timeline")
	var timeline = _json(files[timeline_path], timeline_path)
	if timeline == null: return null
	if timeline.get("interpolation") != "step" or not timeline.get("draws") is Dictionary:
		return _fail("Unsupported timeline")
	var asset := Asset.new()
	asset.manifest = manifest
	asset.timeline = timeline
	asset.files = files
	var draw_ids := {}
	for item in manifest.layers:
		if not item is Dictionary or not files.has(item.get("path", "")): return _fail("Missing layer descriptor")
		var layer = _json(files[item.path], item.path)
		if layer == null: return null
		if not layer.get("kind") in ["particles", "ring", "shell", "trail", "beam", "sprite", "decal", "blob", "crystals", "splash", "ribbon", "wireBurst", "arcs", "streakBurst", "sheets", "crescent", "licks", "reflection"]: return _fail("Unsupported layer kind")
		if not (layer.get("start") is float or layer.get("start") is int) or not (layer.get("end") is float or layer.get("end") is int): return _fail("Invalid layer window")
		if not layer.get("draws") is Array: return _fail("Missing draws")
		for draw in layer.draws:
			if not draw is Dictionary or not draw.get("program") in PROGRAMS: return _fail("Unsupported shader program")
			if not manifest.get("programs", {}).has(draw.program): return _fail("Missing program fingerprint")
			var id: String = draw.get("id", "")
			if id.is_empty() or draw_ids.has(id) or not timeline.draws.has(id): return _fail("Invalid draw ID/timeline")
			draw_ids[id] = true
			if not files.has(draw.get("mesh", "")) or not draw.get("uniforms") is Dictionary: return _fail("Missing draw mesh/uniforms")
			if draw.get("instances") != null and not files.has(draw.instances): return _fail("Missing particle attributes")
			var state: Dictionary = draw.get("renderState", {})
			if not state.get("blend") in ["alpha", "additive", "premultiplied"]: return _fail("Unsupported blend mode (screen is not supported)")
			if not state.get("side") in ["double", "front", "back"]: return _fail("Unsupported cull state")
			for uniform in draw.uniforms.values():
				if not uniform is Dictionary: return _fail("Invalid uniform")
				if uniform.has("value") and not _value_valid(uniform.value, uniform): return _fail("Invalid numeric uniform value")
				var binding: Dictionary = uniform.get("binding", {})
				if binding.get("source") == "bundle" and not files.has(binding.get("path", "")): return _fail("Missing texture")
				if binding.get("source") == "bundle" and binding.get("colorSpace") != "linear": return _fail("Only linear texture data is supported")
			var samples = timeline.draws[id]
			if not samples is Array or samples.is_empty() or samples.size() > 2048: return _fail("Invalid timeline size")
			var last := -1.0
			for sample in samples:
				if not sample is Dictionary: return _fail("Invalid sample")
				var time: float = sample.get("time", -1.0)
				if not is_finite(time) or time < 0 or time <= last or time > duration: return _fail("Unordered sample times")
				last = time
				if not files.has(sample.get("mesh", "")) or not sample.get("uniforms") is Dictionary: return _fail("Invalid sampled data")
				if sample.get("instances") != null and not files.has(sample.instances): return _fail("Missing sampled instances")
				for name in sample.uniforms:
					if not draw.uniforms.has(name) or not _value_valid(sample.uniforms[name], draw.uniforms[name]): return _fail("Invalid timeline uniform: " + name)
				if not sample.get("matrix") is Array or sample.matrix.size() != 16: return _fail("Invalid transform")
				for value in sample.matrix:
					if not (value is float or value is int) or not is_finite(value): return _fail("Non-finite transform")
			if samples[0].time != 0: return _fail("Timeline must begin at zero")
		asset.layers.append(layer)
	if draw_ids.is_empty() or draw_ids.size() > 256: return _fail("Invalid draw count")
	return asset
