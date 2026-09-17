extends Node3D
## Native, camera-independent 3D AVFX player. No ParticleProcessMaterial simulation.
@export_file("*.json") var bundle_path: String
@export var playing: bool = true
@export var looping: bool = true
@export var time: float = 0.0
var manifest: Dictionary
var base_dir: String
var draws: Array = []
var meshes: Dictionary = {}
var textures: Dictionary = {}
var materials: Array[ShaderMaterial] = []

func load_bundle(path: String) -> void:
	base_dir = path.get_base_dir()
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Dictionary or parsed.get("format") != "avfx/0.1":
		push_error("Unsupported AVFX bundle")
		return
	manifest = parsed
	for d in manifest.draws:
		var variants: Dictionary = {}
		for sample in d.samples:
			var key := int(bool(sample.depthWrite))
			if variants.has(key): continue
			var compiled := Shader.new()
			compiled.code = FileAccess.get_file_as_string(base_dir.path_join("shaders/" + d.id + "-" + str(key) + ".gdshader"))
			variants[key] = compiled
		var shader: Shader = variants[int(bool(d.samples[0].depthWrite))]
		var material := ShaderMaterial.new()
		material.shader = shader
		material.render_priority = clampi(int(d.order), -128, 127)
		for key in d.textures:
			var file: String = base_dir.path_join(d.textures[key])
			if not textures.has(file):
				var image: Image
				if file.ends_with(".rgba32f"):
					var info = JSON.parse_string(FileAccess.get_file_as_string(file+".json"))
					image = Image.create_from_data(int(info.width),int(info.height),false,Image.FORMAT_RGBAF,FileAccess.get_file_as_bytes(file))
				else:
					image = Image.load_from_file(file)
					image.flip_y()
					image.generate_mipmaps()
				textures[file] = ImageTexture.create_from_image(image)
			material.set_shader_parameter(key, textures[file])
		var node := MeshInstance3D.new()
		node.name = d.id
		node.material_override = material
		node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		node.extra_cull_margin = 16384.0
		add_child(node)
		draws.append({"node":node,"data":d,"geometry":-1,"variants":variants,"depth":-1})
		materials.append(material)
	seek(time)

func vector3s(a: Array) -> PackedVector3Array:
	var out := PackedVector3Array()
	for i in range(0,a.size(),3): out.append(Vector3(a[i],a[i+1],a[i+2]))
	return out

func build_mesh(index: int) -> ArrayMesh:
	var g: Dictionary = manifest.geometries[index]
	if int(g.baseGeometry) >= 0:
		index = int(g.baseGeometry)
		g = manifest.geometries[index]
	if meshes.has(index): return meshes[index]
	if g.positions.is_empty():
		var empty := ArrayMesh.new()
		meshes[index] = empty
		return empty
	var a: Array = []
	a.resize(Mesh.ARRAY_MAX)
	a[Mesh.ARRAY_VERTEX] = vector3s(g.positions)
	a[Mesh.ARRAY_NORMAL] = vector3s(g.normals)
	var uv := PackedVector2Array()
	for i in range(0,g.uv.size(),2): uv.append(Vector2(g.uv[i],g.uv[i+1]))
	a[Mesh.ARRAY_TEX_UV] = uv
	var rows := PackedVector2Array()
	for row in g.attributeIndex: rows.append(Vector2(float(row),0))
	a[Mesh.ARRAY_TEX_UV2] = rows
	a[Mesh.ARRAY_INDEX] = PackedInt32Array(g.indices)
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_LINES if g.primitive == "lines" else Mesh.PRIMITIVE_TRIANGLES,a)
	mesh.custom_aabb = AABB(Vector3(-8192,-8192,-8192),Vector3(16384,16384,16384))
	meshes[index] = mesh
	return mesh

func uniform_value(v, binding: Dictionary):
	var kind: String = binding.get("type", "float")
	if int(binding.get("size", 0)) > 0:
		if kind == "float": return PackedFloat32Array(v)
		if kind == "int": return PackedInt32Array(v)
		var out: Array = []
		for item in v: out.append(uniform_value(item, {"type":kind}))
		return out
	match kind:
		"int": return int(v)
		"bool": return bool(v)
		"vec2": return Vector2(v[0],v[1])
		"vec3": return Vector3(v[0],v[1],v[2])
		"vec4": return Vector4(v[0],v[1],v[2],v[3])
	return float(v)

func seek(seconds: float) -> void:
	if manifest.is_empty(): return
	time = clampf(seconds,0.0,float(manifest.duration))
	var frame: int = int(floor(time * float(manifest.fps) + 0.00001))
	for i in draws.size():
		var entry: Dictionary = draws[i]
		var d: Dictionary = entry.data
		var s: Dictionary = d.samples[mini(frame,d.samples.size()-1)]
		var node: MeshInstance3D = entry.node
		node.visible = s.visible
		var m: Array = s.matrix
		node.transform = Transform3D(Basis(Vector3(m[0],m[1],m[2]),Vector3(m[4],m[5],m[6]),Vector3(m[8],m[9],m[10])),Vector3(m[12],m[13],m[14]))
		var material: ShaderMaterial = materials[i]
		var depth := int(bool(s.depthWrite))
		if entry.depth != depth:
			material.shader = entry.variants[depth]
			entry.depth = depth
		if entry.geometry != int(s.geometry):
			entry.geometry = int(s.geometry)
			node.mesh = build_mesh(int(s.geometry))
			var stem: String = base_dir.path_join("attributes/" + d.id + "-" + str(int(s.geometry)))
			var info = JSON.parse_string(FileAccess.get_file_as_string(stem + ".json"))
			var image := Image.create_from_data(int(info.width),int(info.height),false,Image.FORMAT_RGBAF,FileAccess.get_file_as_bytes(stem + ".bin"))
			material.set_shader_parameter("avfxAttributes",ImageTexture.create_from_image(image))
		for key in s.uniforms:
			material.set_shader_parameter(key, uniform_value(s.uniforms[key], d.uniformTypes[key]))
		if s.uniforms.has("uTime"):
			material.set_shader_parameter("uTime",float(s.uniforms.uTime)+time-float(s.time))
		var camera := get_viewport().get_camera_3d()
		if camera: material.set_shader_parameter("uCam",camera.global_position)

func _ready() -> void:
	if not bundle_path.is_empty(): load_bundle(bundle_path)

func _process(delta: float) -> void:
	if manifest.is_empty(): return
	var t := time + delta if playing else time
	if looping: t = fmod(t,float(manifest.duration))
	seek(t)
