extends SceneTree

func _initialize() -> void:
	call_deferred("run")

func capture(viewport: SubViewport) -> PackedByteArray:
	await process_frame
	await process_frame
	await RenderingServer.frame_post_draw
	return viewport.get_texture().get_image().get_data()

func run() -> void:
	var viewport := SubViewport.new()
	viewport.size = Vector2i(256, 256)
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	viewport.own_world_3d = true
	root.add_child(viewport)
	var camera := Camera3D.new()
	viewport.add_child(camera)
	camera.position = Vector3(3, 3, 6)
	camera.look_at(Vector3(0, 0.5, 0))
	camera.current = true
	var empty = await capture(viewport)
	var failures := 0
	for kind in ["blob", "crystals", "splash", "ribbon", "wireBurst", "arcs", "streakBurst", "sheets", "crescent", "licks"]:
		var player = load("res://addons/autov_avfx/player.gd").new()
		player.autoplay = false
		viewport.add_child(player)
		var loaded: bool = player.load_file("res://generators/" + kind + ".avfx") == OK
		await process_frame
		if not loaded or not player.last_error.is_empty() or player._draws.is_empty():
			push_error(kind + ": failed to load: " + player.last_error)
			failures += 1
		else:
			player.set_process(false)
			var first_time: float = 0.45 if kind in ["crescent", "licks"] else 0.2
			player.seek(first_time)
			for draw in player._draws:
				if draw.layer.kind != kind: draw.node.hide()
			var first = await capture(viewport)
			player.seek(0.65)
			for draw in player._draws:
				if draw.layer.kind != kind: draw.node.hide()
			var second = await capture(viewport)
			player.seek(first_time)
			for draw in player._draws:
				if draw.layer.kind != kind: draw.node.hide()
			var rewind = await capture(viewport)
			if first == empty or second == empty or first == second or first != rewind:
				push_error(kind + ": pixel check failed (visible1=%s visible2=%s animated=%s rewind=%s)" % [first != empty, second != empty, first != second, first == rewind])
				failures += 1
			else:
				print("AVFX_GENERATOR_CHECK: ", kind, " rendered, animated, rewound")
			viewport.get_texture().get_image().save_png("user://generator-" + kind + ".png")
		player.queue_free()
		await process_frame
	print("AVFX_GENERATOR_CHECK: failures=", failures)
	quit(1 if failures else 0)
