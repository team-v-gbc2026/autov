@tool
extends Node3D
## Runtime AVFX player. One absolute clock; seeking does not simulate history.
signal finished
signal load_failed(message: String)

const BundleLoader = preload("bundle_loader.gd")
const MeshBuilder = preload("mesh_builder.gd")
const ParticleShader = preload("shaders/particle.gdshader")
const SurfaceShader = preload("shaders/surface.gdshader")
const ShaderLibrary = preload("shader_library.gd")
const ShaderVersions = preload("shader_versions.gd")

@export var effect: Resource:
	set(value):
		effect = value
		if is_inside_tree(): _rebuild.call_deferred()
@export var autoplay := true
@export var loop := true
@export_range(0.0, 4.0, 0.05) var speed := 1.0
@export_group("Editor Preview")
## Animate in the editor. When disabled, Preview Time selects a still frame.
@export var editor_preview := false
@export_range(0.0, 12.0, 0.01) var preview_time := 1.0:
	set(value):
		preview_time = value
		if Engine.is_editor_hint() and is_inside_tree(): seek(value)
## Camera-facing uniforms follow this editor viewport (0 is the main view).
@export_range(0, 3, 1) var editor_viewport := 0

var time := 0.0
var playing := false
var last_error := ""
var _draws: Array[Dictionary] = []
var _meshes := {}
var _textures := {}
var _attribute_textures := {}
var _builder := MeshBuilder.new()
var _root: Node3D

func _ready() -> void:
	_rebuild()

func _fail(message: String) -> void:
	last_error = message
	playing = false
	_clear()
	push_error("AVFX: " + message)
	load_failed.emit(message)

func _clear() -> void:
	_draws.clear(); _meshes.clear(); _textures.clear(); _attribute_textures.clear()
	if is_instance_valid(_root):
		remove_child(_root)
		_root.queue_free()
	_root = null

func load_file(path: String) -> Error:
	var loader := BundleLoader.new()
	var loaded = loader.load_bundle(path)
	if loaded == null:
		_fail(loader.error)
		return ERR_FILE_CORRUPT
	effect = loaded
	return OK

func _mesh_key(path: String, instances, program: String) -> String:
	return path + ":" + program + ":" + (str(instances.get("_id", "")) if instances != null else "surface")

func _mesh(path: String, instances = null, program := "surface"):
	var key := _mesh_key(path, instances, program)
	if _meshes.has(key): return _meshes[key]
	if not effect.files.has(path):
		last_error = "Missing mesh " + path
		return null
	var base = _builder.read_glb(effect.files[path])
	if base == null:
		last_error = _builder.error
		return null
	var generic: bool = program not in ["particle", "surface"]
	var mesh = _builder.build(base, instances, generic)
	if mesh == null:
		last_error = _builder.error
		return null
	_meshes[key] = mesh
	if generic:
		var layout: Array = ShaderVersions.ATTRIBUTES[program]
		if not layout.is_empty():
			var texture = _builder.attribute_texture(base, instances, layout)
			if texture == null:
				last_error = _builder.error
				return null
			_attribute_textures[key] = texture
	return mesh

func _texture(binding: Dictionary):
	var path: String = binding.path
	var key := path + str(binding.get("flipY", false)) + str(binding.get("generateMipmaps", false))
	if _textures.has(key): return _textures[key]
	var image := Image.new()
	if path.ends_with(".png"):
		var bytes: PackedByteArray = effect.files[path]
		if bytes.size() < 24:
			last_error = "Truncated PNG"
			return null
		# PNG dimensions are big-endian, checked before image allocation.
		var width := (int(bytes[16]) << 24) | (int(bytes[17]) << 16) | (int(bytes[18]) << 8) | int(bytes[19])
		var height := (int(bytes[20]) << 24) | (int(bytes[21]) << 16) | (int(bytes[22]) << 8) | int(bytes[23])
		if width <= 0 or height <= 0 or width > 4096 or height > 4096 or image.load_png_from_buffer(bytes) != OK:
			last_error = "Invalid or oversized texture " + path
			return null
		if binding.get("flipY", false): image.flip_y()
		if binding.get("generateMipmaps", false): image.generate_mipmaps()
	else:
		var data = JSON.parse_string(effect.files[path].get_string_from_utf8())
		if not data is Dictionary or data.get("encoding") != "raw-data-texture" or data.get("type") != 1015 or data.get("format") != 1023:
			last_error = "Unsupported data texture " + path
			return null
		var width: int = int(data.get("width", 0))
		var height: int = int(data.get("height", 0))
		if width < 1 or height < 1 or width * height > 1048576 or not data.get("values") is Array or data.values.size() != width * height * 4:
			last_error = "Invalid data texture dimensions"
			return null
		var packed := PackedFloat32Array(data.values)
		image = Image.create_from_data(width, height, false, Image.FORMAT_RGBAF, packed.to_byte_array())
	var texture := ImageTexture.create_from_image(image)
	_textures[key] = texture
	return texture

func _typed(value, definition: Dictionary):
	var type: String = definition.type
	if definition.has("size"):
		match type:
			"float": return PackedFloat32Array(value)
			"int": return PackedInt32Array(value)
			"vec2":
				var packed := PackedVector2Array()
				for row in value: packed.append(Vector2(row[0], row[1]))
				return packed
			"vec3":
				var packed := PackedVector3Array()
				for row in value: packed.append(Vector3(row[0], row[1], row[2]))
				return packed
			"vec4":
				var packed := PackedVector4Array()
				for row in value: packed.append(Vector4(row[0], row[1], row[2], row[3]))
				return packed
	match type:
		"int": return int(value)
		"float": return float(value)
		"vec2": return Vector2(value[0], value[1])
		"vec3": return Vector3(value[0], value[1], value[2])
		"vec4": return Vector4(value[0], value[1], value[2], value[3])
	return value

func _rebuild() -> void:
	_clear()
	last_error = ""
	if effect == null: return
	if effect.get_script() != preload("asset.gd"):
		_fail("Effect must be an imported AVFX asset")
		return
	_root = Node3D.new()
	_root.name = "AVFXDraws"
	add_child(_root)
	for layer in effect.layers:
		for descriptor in layer.draws:
			var instances = null
			var attribute_texture = null
			if descriptor.get("instances") != null:
				instances = JSON.parse_string(effect.files[descriptor.instances].get_string_from_utf8())
				if not instances is Dictionary:
					_fail("Invalid particle attributes"); return
				instances["_id"] = descriptor.instances
				if descriptor.program == "particle":
					attribute_texture = _builder.instance_texture(instances)
					if attribute_texture == null: _fail(_builder.error); return
			var mesh = _mesh(descriptor.mesh, instances, descriptor.program)
			if mesh == null: _fail(last_error); return
			var template: Shader = ShaderLibrary.PROGRAMS[descriptor.program]
			var material := ShaderMaterial.new()
			var shader := Shader.new()
			# Only shipped code is specialized. Bundle kernel files are never read
			# as shader programs; blend choice is a numeric uniform.
			shader.code = template.code.replace("depth_draw_never", "depth_draw_always") if descriptor.renderState.get("depthWrite", false) else template.code
			if not descriptor.renderState.get("depthTest", true):
				shader.code = shader.code.replace("render_mode ", "render_mode depth_test_disabled, ")
			var side: String = descriptor.renderState.get("side", "double")
			if side != "double":
				# The mesh builder already reverses source triangle winding.
				shader.code = shader.code.replace("cull_disabled", "cull_back" if side == "front" else "cull_front")
			material.shader = shader
			material.render_priority = clampi(int(descriptor.renderState.get("renderOrder", 0)), -128, 127)
			material.set_shader_parameter("avfx_blend_kind", {"additive": 0, "alpha": 1, "premultiplied": 2}[descriptor.renderState.blend])
			if attribute_texture != null: material.set_shader_parameter("avfx_attributes", attribute_texture)
			var generic_key := _mesh_key(descriptor.mesh, instances, descriptor.program)
			if _attribute_textures.has(generic_key): material.set_shader_parameter("avfxAttributes", _attribute_textures[generic_key])
			for name in descriptor.uniforms:
				var definition: Dictionary = descriptor.uniforms[name]
				if definition.has("value"): material.set_shader_parameter(name, _typed(definition.value, definition))
				var binding: Dictionary = definition.get("binding", {})
				if binding.get("source") == "bundle":
					var texture = _texture(binding)
					if texture == null: _fail(last_error); return
					material.set_shader_parameter(name, texture)
			var node := MeshInstance3D.new()
			node.name = descriptor.id
			node.mesh = mesh
			node.material_override = material
			node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			_root.add_child(node)
			_draws.append({"node": node, "material": material, "descriptor": descriptor,
				"layer": layer, "instances": instances, "samples": effect.timeline.draws[descriptor.id], "sample": -1})
	playing = autoplay and not Engine.is_editor_hint()
	seek(preview_time if Engine.is_editor_hint() else 0.0)
	update_configuration_warnings()

func _get_configuration_warnings() -> PackedStringArray:
	var warnings := PackedStringArray()
	if effect == null: warnings.append("Assign an imported .avfx resource to Effect.")
	if not last_error.is_empty(): warnings.append(last_error)
	if effect != null: warnings.append("Experimental adapter: particles use seed order (no per-particle alpha sorting). Excluded lights, environment and post-processing are not recreated.")
	return warnings

func play(restart := false) -> void:
	if restart or (effect != null and time >= float(effect.manifest.duration)): seek(0.0)
	playing = true

func pause() -> void: playing = false
func stop() -> void:
	playing = false
	seek(0.0)

func seek(seconds: float) -> void:
	if effect == null or not is_finite(seconds): return
	time = clampf(seconds, 0.0, float(effect.manifest.duration))
	_apply_time()

func _process(delta: float) -> void:
	if effect == null: return
	if Engine.is_editor_hint():
		if editor_preview:
			time = fmod(time + delta * speed, float(effect.manifest.duration))
		else:
			time = clampf(preview_time, 0.0, float(effect.manifest.duration))
	elif playing:
		time += delta * speed
		if time >= float(effect.manifest.duration):
			if loop: time = fmod(time, float(effect.manifest.duration))
			else:
				time = float(effect.manifest.duration)
				playing = false
				finished.emit()
	_apply_time()

func _apply_time() -> void:
	var viewport: Viewport = get_viewport()
	# Resolve dynamically so exported games have no EditorInterface dependency.
	if Engine.is_editor_hint() and Engine.has_singleton("EditorInterface"):
		var editor = Engine.get_singleton("EditorInterface")
		var editor_view = editor.get_editor_viewport_3d(editor_viewport)
		if editor_view != null: viewport = editor_view
	var camera := viewport.get_camera_3d()
	for draw in _draws:
		var samples: Array = draw.samples
		var low := 0
		var high := samples.size() - 1
		while low < high:
			var middle: int = (low + high + 1) / 2
			if float(samples[middle].time) <= time: low = middle
			else: high = middle - 1
		var sample: Dictionary = samples[low]
		if low != draw.sample:
			draw.sample = low
			var instance_path = sample.get("instances", draw.descriptor.get("instances"))
			if instance_path != null and (draw.instances == null or draw.instances.get("_id") != instance_path):
				var instances = JSON.parse_string(effect.files[instance_path].get_string_from_utf8())
				if not instances is Dictionary: _fail("Invalid sampled instances"); return
				instances["_id"] = instance_path
				draw.instances = instances
				if draw.descriptor.program == "particle":
					var texture = _builder.instance_texture(instances)
					if texture == null: _fail(_builder.error); return
					draw.material.set_shader_parameter("avfx_attributes", texture)
			var matrix: Array = sample.matrix
			draw.node.transform = Transform3D(Basis(Vector3(matrix[0], matrix[1], matrix[2]), Vector3(matrix[4], matrix[5], matrix[6]), Vector3(matrix[8], matrix[9], matrix[10])), Vector3(matrix[12], matrix[13], matrix[14]))
			var mesh = _mesh(sample.mesh, draw.instances, draw.descriptor.program)
			if mesh == null: _fail(last_error); return
			draw.node.mesh = mesh
			var generic_key := _mesh_key(sample.mesh, draw.instances, draw.descriptor.program)
			if _attribute_textures.has(generic_key): draw.material.set_shader_parameter("avfxAttributes", _attribute_textures[generic_key])
			for name in sample.uniforms:
				var definition: Dictionary = draw.descriptor.uniforms.get(name, {})
				if definition.has("type") and definition.get("storage") != "constant":
					draw.material.set_shader_parameter(name, _typed(sample.uniforms[name], definition))
		draw.node.visible = bool(sample.visible) and time >= float(draw.layer.start) and time < float(draw.layer.end)
		draw.material.set_shader_parameter("uTime", maxf(0.0, time - float(draw.layer.start)))
		if camera != null:
			draw.material.set_shader_parameter("uCam", camera.global_position)
			draw.material.set_shader_parameter("uNear", camera.near)
			draw.material.set_shader_parameter("uFar", camera.far)
			draw.material.set_shader_parameter("uSmokeRight", camera.global_basis.x)
			draw.material.set_shader_parameter("uSmokeUp", camera.global_basis.y)
			draw.material.set_shader_parameter("uSmokeForward", camera.global_basis.z)
		draw.material.set_shader_parameter("uResolution", viewport.get_visible_rect().size)
