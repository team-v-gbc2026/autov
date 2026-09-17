extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func check(condition: bool, message: String) -> bool:
	if not condition:
		push_error(message)
		quit(1)
	return condition

func run() -> void:
	var script = load("res://addons/autov_avfx/mesh_builder.gd")
	if not check(script != null and script.can_instantiate(), "Mesh builder does not compile"): return
	var player = load("res://addons/autov_avfx/player.gd")
	if not check(player != null and player.can_instantiate(), "Player does not compile"): return
	var builder = script.new()
	for mode in [1, 4]:
		var base = builder.read_glb(FileAccess.get_file_as_bytes("res://fixtures/mode-%d.glb" % mode))
		if not check(base != null, builder.error): return
		if not check(base.mode == mode, "Lost primitive mode"): return
		var mesh = builder.build(base, null, true)
		if not check(mesh != null, builder.error): return
		if not check(mesh.surface_get_primitive_type(0) == (Mesh.PRIMITIVE_LINES if mode == 1 else Mesh.PRIMITIVE_TRIANGLES), "Wrong engine topology"): return
		var indices = mesh.surface_get_arrays(0)[Mesh.ARRAY_INDEX]
		if not check(indices == (PackedInt32Array([0, 1, 2, 3, 4, 5]) if mode == 1 else PackedInt32Array([0, 2, 1, 3, 5, 4])), "Wrong index order"): return
		var instances = {"count": 2, "attributes": {"aSeed": {"count": 2, "itemSize": 1, "values": [0.25, 0.75]}}}
		var texture = builder.attribute_texture(base, instances, [{"name": "aWeight", "type": "float"}, {"name": "aSeed", "type": "float"}])
		if not check(texture != null, builder.error): return
		var data = texture.get_image().get_data().to_float32_array()
		for vertex in 12:
			if not check(is_equal_approx(data[vertex * 8], float(vertex % 6)) and is_equal_approx(data[vertex * 8 + 4], 0.25 if vertex < 6 else 0.75), "Mixed vertex/instance packing differs"): return
	var before = builder.read_glb(FileAccess.get_file_as_bytes("res://fixtures/before.glb"))
	var after = builder.read_glb(FileAccess.get_file_as_bytes("res://fixtures/after.glb"))
	if not check(before != null and after != null, builder.error): return
	if not check(before.attributes.POSITION.values[0] == 0.0 and after.attributes.POSITION.values[0] == 2.0, "Baked mesh animation is frozen"): return
	print("AVFX_MESH_CHECK: topology, winding, mixed attributes, animated snapshots and player compilation passed")
	quit(0)
