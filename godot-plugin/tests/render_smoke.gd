extends SceneTree

func _initialize() -> void:
	run.call_deferred()

func run() -> void:
	var scene = load("res://demo/main.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	await process_frame
	if not scene.player.last_error.is_empty() or scene.player.effect == null:
		push_error("Failed to build effect"); quit(1); return
	scene.player.pause()
	scene.player.seek(1.25)
	for i in 12: await process_frame
	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	DirAccess.make_dir_recursive_absolute("res://test-output")
	image.save_png("res://test-output/fire-projectile.png")
	print("AVFX rendered frame saved to test-output/fire-projectile.png")
	quit()
