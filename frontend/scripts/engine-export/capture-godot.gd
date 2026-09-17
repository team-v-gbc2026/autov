extends SceneTree
func _initialize() -> void:
	call_deferred("capture")
func capture() -> void:
	var scene = load("res://main.tscn").instantiate()
	root.add_child(scene)
	root.size=Vector2i(640,360)
	await process_frame
	scene.player.playing=false
	scene.player.seek(float(scene.player.manifest.reference.time))
	var base_yaw=scene.yaw
	var out=ProjectSettings.globalize_path("res://").trim_suffix("/").get_base_dir()
	for angle in [0.0,1.570796,3.141593]:
		scene.yaw=base_yaw+angle
		scene.update_camera()
		for frame in 6:
			await process_frame
			await RenderingServer.frame_post_draw
		var image=root.get_texture().get_image()
		var file=out.path_join("godot-view-"+str(int(round(angle*180.0/PI)))+".png")
		image.save_png(file)
		print("CAPTURE ",file)
	quit()
