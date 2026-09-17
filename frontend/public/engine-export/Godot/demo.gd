extends Node3D
var camera: Camera3D
var player: Node3D
var target := Vector3.ZERO
var yaw := 0.0
var pitch := 0.2
var radius := 8.0
func _ready() -> void:
	player = load("res://avfx_player.gd").new()
	add_child(player)
	var path := ProjectSettings.globalize_path("res://").trim_suffix("/").get_base_dir().path_join("effect.avfx.json")
	player.load_bundle(path)
	if player.manifest.is_empty(): return
	var c: Dictionary = player.manifest.camera
	camera = Camera3D.new()
	add_child(camera)
	camera.fov = float(c.fov)
	camera.near = float(c.near)
	camera.far = float(c.far)
	target = Vector3(c.target[0],c.target[1],c.target[2])
	var pos := Vector3(c.position[0],c.position[1],c.position[2])
	var dir := pos-target
	radius = dir.length()
	yaw = atan2(dir.x,dir.z)
	pitch = asin(dir.y/radius)
	update_camera()
	var environment := WorldEnvironment.new()
	environment.environment = Environment.new()
	environment.environment.background_mode = Environment.BG_COLOR
	environment.environment.background_color = Color(player.manifest.get("reference", {}).get("background", "#1b1a1f"))
	environment.environment.tonemap_mode = Environment.TONE_MAPPER_ACES
	environment.environment.tonemap_exposure = float(player.manifest.get("reference", {}).get("exposure", 1.0)) / 1.08
	# Match the ACES reference fit: Godot scales input by 1.8, Three by 1/0.6.
	# This white point makes Godot's additional curve normalization equal to one.
	environment.environment.tonemap_white = 14.260243850354401
	add_child(environment)
func update_camera() -> void:
	camera.position = target+Vector3(sin(yaw)*cos(pitch),sin(pitch),cos(yaw)*cos(pitch))*radius
	camera.look_at(target)
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		yaw -= event.relative.x*.005
		pitch = clampf(pitch+event.relative.y*.005,-1.4,1.4)
		update_camera()
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP: radius *= .9
		if event.button_index == MOUSE_BUTTON_WHEEL_DOWN: radius *= 1.1
		update_camera()
	if event is InputEventKey and event.pressed and event.keycode == KEY_SPACE: player.playing = not player.playing
