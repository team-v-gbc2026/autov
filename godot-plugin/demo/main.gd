@tool
extends Node3D

var player: Node3D
var label: Label
var slider: HSlider

func _ready() -> void:
	player = get_node("AVFXPlayer")
	if Engine.is_editor_hint():
		# The saved child is editable in the Inspector, unlike runtime-only nodes.
		# Only use the local example as a fallback; never replace an assigned effect.
		var example := "res://examples/fire-projectile.avfx"
		if player.effect == null and ResourceLoader.exists(example):
			player.effect = load(example)
		return
	var camera := Camera3D.new()
	camera.position = Vector3(6, 4, 9)
	camera.fov = 32
	add_child(camera)
	camera.look_at(Vector3(0, 1.2, 0))
	camera.current = true
	var canvas := CanvasLayer.new()
	add_child(canvas)
	var panel := VBoxContainer.new()
	panel.position = Vector2(24, 24)
	panel.custom_minimum_size = Vector2(620, 0)
	canvas.add_child(panel)
	label = Label.new()
	label.text = "AutoV → Godot | avfx/0.1"
	panel.add_child(label)
	var buttons := HBoxContainer.new()
	panel.add_child(buttons)
	for title in ["Play", "Pause", "Restart", "Open .avfx"]:
		var button := Button.new()
		button.text = title
		buttons.add_child(button)
		match title:
			"Play": button.pressed.connect(func(): player.play())
			"Pause": button.pressed.connect(func(): player.pause())
			"Restart": button.pressed.connect(func(): player.play(true))
			"Open .avfx": button.pressed.connect(_open_file)
	slider = HSlider.new()
	slider.min_value = 0
	slider.max_value = 3.5
	slider.step = 0.01
	panel.add_child(slider)
	slider.value_changed.connect(func(value): player.pause(); player.seek(value))
	player.load_failed.connect(func(message): label.text = message)
	var args := OS.get_cmdline_user_args()
	var path: String = args[0] if not args.is_empty() else "res://examples/fire-projectile.avfx"
	if args.is_empty() and player.effect != null:
		slider.max_value = float(player.effect.manifest.duration)
		label.text = player.effect.manifest.name + " — experimental particle/surface adapter"
	elif FileAccess.file_exists(path): _load_effect(path)
	else: label.text = "Export fire-projectile from /dev/avfx, then choose Open .avfx."

func _load_effect(path: String) -> void:
	if player.load_file(path) == OK:
		slider.max_value = float(player.effect.manifest.duration)
		label.text = player.effect.manifest.name + " — experimental particle/surface adapter"

func _open_file() -> void:
	var dialog := FileDialog.new()
	dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dialog.access = FileDialog.ACCESS_FILESYSTEM
	dialog.filters = PackedStringArray(["*.avfx ; AutoV effect"])
	add_child(dialog)
	dialog.file_selected.connect(_load_effect)
	dialog.visibility_changed.connect(func(): if not dialog.visible: dialog.queue_free())
	dialog.popup_centered_ratio(0.75)

func _process(_delta: float) -> void:
	if Engine.is_editor_hint(): return
	if slider != null and player != null: slider.set_value_no_signal(player.time)
