@tool
extends Node3D
## Run explicitly with --editor tests/editor_preview.tscn -- --avfx-editor-test.

func _ready() -> void:
	if not Engine.is_editor_hint() or not "--avfx-editor-test" in OS.get_cmdline_user_args(): return
	run.call_deferred()

func run() -> void:
	var player = preload("../addons/autov_avfx/player.gd").new()
	player.effect = load("res://examples/fire-projectile.avfx")
	add_child(player)
	for i in 10: await get_tree().process_frame
	assert(player.last_error.is_empty(), player.last_error)
	assert(player._draws.size() == 8)
	assert(is_equal_approx(player.time, player.preview_time))
	var camera = EditorInterface.get_editor_viewport_3d(0).get_camera_3d()
	assert(camera != null)
	assert(player._draws[0].material.get_shader_parameter("uCam") == camera.global_position)
	player.preview_time = 0.5
	await get_tree().process_frame
	assert(is_equal_approx(player.time, 0.5))
	player.editor_preview = true
	player._process(0.25)
	assert(is_equal_approx(player.time, 0.75))
	player.editor_preview = false
	player._process(0.25)
	assert(is_equal_approx(player.time, 0.5))
	var visible_draws := 0
	for draw in player._draws:
		if draw.node.visible: visible_draws += 1
	assert(visible_draws > 0)
	assert(player._root.owner == null)
	var inspector = preload("../addons/autov_avfx/inspector.gd").new()
	assert(inspector._can_handle(player))
	var unrelated := Node3D.new()
	assert(not inspector._can_handle(unrelated))
	unrelated.free()
	var panel = preload("../addons/autov_avfx/inspector_panel.gd").new()
	panel.target = player
	panel.undo_redo = EditorInterface.get_editor_undo_redo()
	add_child(panel)
	panel._edit({"speed": 2.0}, "Test AVFX speed")
	assert(player.speed == 2.0)
	var history = panel.undo_redo.get_history_undo_redo(panel.undo_redo.get_object_history_id(player))
	history.undo()
	assert(player.speed == 1.0)
	history.redo()
	assert(player.speed == 2.0)
	panel._toggle_preview()
	assert(player.editor_preview)
	panel._toggle_preview()
	assert(not player.editor_preview)
	panel._assign_effect(Resource.new())
	assert(player.effect != null)
	panel._process(0)
	assert(panel.status.text.contains("layers"))
	print("AVFX editor preview checks: PASS")
	get_tree().quit()
