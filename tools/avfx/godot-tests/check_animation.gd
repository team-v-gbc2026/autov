extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func check(condition: bool, message: String) -> bool:
	if not condition:
		push_error(message)
		quit(1)
	return condition

func capture(viewport: SubViewport) -> Image:
	await process_frame
	await process_frame
	await RenderingServer.frame_post_draw
	return viewport.get_texture().get_image()

func run() -> void:
	var viewport := SubViewport.new()
	viewport.size = Vector2i(256, 256)
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	viewport.own_world_3d = true
	root.add_child(viewport)
	var camera := Camera3D.new()
	viewport.add_child(camera)
	camera.position = Vector3(0, 0, 6)
	camera.current = true
	var player = load("res://addons/autov_avfx/player.gd").new()
	player.autoplay = false
	viewport.add_child(player)
	if not check(player.load_file("res://fixtures/animation.avfx") == OK, player.last_error): return
	await process_frame
	if not check(player.last_error.is_empty() and player._draws.size() == 1, "Bundle playback rebuild failed: " + player.last_error): return
	player.seek(0.25)
	var first_mesh = player._draws[0].node.mesh
	var first = await capture(viewport)
	player.seek(1.5)
	var second_mesh = player._draws[0].node.mesh
	var second = await capture(viewport)
	if not check(first_mesh != second_mesh, "Timeline did not switch baked meshes"): return
	if not check(first.get_data() != second.get_data(), "Animated meshes produced identical pixels"): return
	player.seek(0.25)
	var rewind = await capture(viewport)
	if not check(player._draws[0].node.mesh == first_mesh and rewind.get_data() == first.get_data(), "Rewind is not deterministic"): return
	player.seek(2.0)
	var ended = await capture(viewport)
	if not check(not player._draws[0].node.visible and ended.get_data() != first.get_data(), "Effect did not end"): return
	first.save_png("user://baked-animation-before.png")
	second.save_png("user://baked-animation-after.png")
	print("AVFX_ANIMATION_CHECK: imported bundle, changing rendered meshes, exact rewind and end visibility passed")
	viewport.queue_free()
	await process_frame
	quit(0)
