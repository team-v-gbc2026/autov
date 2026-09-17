extends SceneTree

const Loader = preload("../addons/autov_avfx/bundle_loader.gd")
const Player = preload("../addons/autov_avfx/player.gd")
var failures := 0

func check(condition: bool, message: String) -> void:
	if not condition:
		failures += 1
		push_error(message)

func _initialize() -> void:
	run.call_deferred()

func run() -> void:
	var args := OS.get_cmdline_user_args()
	if args.is_empty():
		push_error("Pass a fire-projectile.avfx path after --")
		quit(1); return
	var loader := Loader.new()
	var asset = loader.load_bundle(args[0])
	check(asset != null, loader.error)
	if asset == null: quit(1); return
	check(asset.layers.size() == 8, "Expected eight fire-projectile layers")
	if ResourceLoader.exists("res://examples/fire-projectile.avfx"):
		var imported = ResourceLoader.load("res://examples/fire-projectile.avfx")
		check(imported != null and imported.layers.size() == 8, "Editor-imported resource must load")
	var player := Player.new()
	player.autoplay = false
	player.effect = asset
	root.add_child(player)
	await process_frame
	check(player.last_error.is_empty(), player.last_error)
	check(player._draws.size() == 8, "Expected eight reconstructed draws")
	for draw in player._draws:
		if draw.instances != null:
			var texture: Texture2D = draw.material.get_shader_parameter("avfx_attributes")
			var seed: Color = texture.get_image().get_pixel(0, 0)
			var source: Array = draw.instances.attributes.aSeed.values
			check(is_equal_approx(seed.r, source[0]) and is_equal_approx(seed.g, source[1]) and is_equal_approx(seed.b, source[2]) and is_equal_approx(seed.a, source[3]), "Original seed must survive packing")
	player.seek(0.5)
	var transforms := []
	for draw in player._draws: transforms.append(draw.node.transform)
	player.seek(1.5)
	player.seek(0.5)
	for index in player._draws.size():
		check(player._draws[index].node.transform == transforms[index], "Backward seek must reproduce transforms")
	player.seek(asset.manifest.duration)
	for draw in player._draws: check(not draw.node.visible, "Ended draw must be hidden")
	player.play(true)
	check(player.playing and player.time == 0.0, "Restart must reset clock")
	player.pause()
	check(not player.playing, "Pause must stop clock")
	var saved := "user://avfx-test.res"
	check(ResourceSaver.save(asset, saved) == OK, "Resource save failed")
	var restored = ResourceLoader.load(saved, "", ResourceLoader.CACHE_MODE_IGNORE)
	check(restored != null and restored.files.size() == asset.files.size(), "Resource roundtrip failed")
	DirAccess.remove_absolute(saved)
	# Alter a PNG body without updating the inventory: integrity must fail.
	var bytes := FileAccess.get_file_as_bytes(args[0])
	var marker := PackedByteArray([137, 80, 78, 71, 13, 10, 26, 10])
	var found := -1
	for index in bytes.size() - 8:
		if bytes[index] == 137 and bytes.slice(index, index + 8) == marker:
			found = index; break
	check(found >= 0, "Fixture must contain PNG data")
	if found >= 0:
		bytes[found + 20] ^= 1
		var corrupt_path := "user://avfx-corrupt-test.avfx"
		var file := FileAccess.open(corrupt_path, FileAccess.WRITE)
		file.store_buffer(bytes); file.close()
		check(loader.load_bundle(corrupt_path) == null and loader.error.contains("Hash/size"), "Corrupted texture must be rejected")
		DirAccess.remove_absolute(corrupt_path)
	player.free()
	print("AVFX bundle checks: ", "PASS" if failures == 0 else "FAIL", " (", failures, " failures)")
	quit(0 if failures == 0 else 1)
