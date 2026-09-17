extends Node3D
var camera: Camera3D
var player: Node3D
var environment: WorldEnvironment
var target := Vector3.ZERO
var yaw := 0.0
var pitch := 0.2
var radius := 8.0
var reference_view := Vector3.ZERO
var bundle_directory: String
var presentation := false
var help_label: Label

func _ready() -> void:
	presentation = "--presentation" in OS.get_cmdline_user_args()
	bundle_directory = ProjectSettings.globalize_path("res://").trim_suffix("/").get_base_dir()
	camera = Camera3D.new()
	add_child(camera)
	environment = WorldEnvironment.new()
	environment.environment = Environment.new()
	environment.environment.background_mode = Environment.BG_COLOR
	environment.environment.tonemap_mode = Environment.TONE_MAPPER_ACES
	# Match Godot's 1.8 scale and Three's 1/0.6 ACES reference fit.
	environment.environment.tonemap_white = 14.260243850354401
	add_child(environment)
	if presentation:
		var overlay := CanvasLayer.new()
		add_child(overlay)
		help_label = Label.new()
		help_label.position = Vector2(20, 16)
		help_label.add_theme_font_size_override("font_size", 24)
		help_label.add_theme_color_override("font_shadow_color", Color.BLACK)
		help_label.add_theme_constant_override("shadow_offset_x", 1)
		help_label.add_theme_constant_override("shadow_offset_y", 1)
		help_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		overlay.add_child(help_label)
	open_bundle(bundle_directory.path_join("effect.avfx.json"))

func open_bundle(path: String) -> void:
	if not FileAccess.file_exists(path):
		push_warning("Presentation bundle is missing: " + path)
		return
	var next_player: Node3D = load("res://avfx_player.gd").new()
	add_child(next_player)
	next_player.load_bundle(path)
	if next_player.manifest.is_empty():
		next_player.queue_free()
		return
	if is_instance_valid(player):
		remove_child(player)
		player.queue_free()
	player = next_player
	var c: Dictionary = player.manifest.camera
	camera.fov = float(c.fov)
	camera.near = float(c.near)
	camera.far = float(c.far)
	target = Vector3(c.target[0],c.target[1],c.target[2])
	var dir := Vector3(c.position[0],c.position[1],c.position[2])-target
	radius = dir.length()
	yaw = atan2(dir.x,dir.z)
	pitch = asin(dir.y/radius)
	reference_view = Vector3(yaw,pitch,radius)
	update_camera()
	environment.environment.background_color = Color(player.manifest.get("reference", {}).get("background", "#1b1a1f"))
	environment.environment.tonemap_exposure = float(player.manifest.get("reference", {}).get("exposure", 1.0)) / 1.08
	DisplayServer.window_set_title("autoV - " + str(player.manifest.name) + " - Godot")
	if help_label:
		help_label.text = str(player.manifest.name) + "   |   1 Fire Projectile   2 Shield\nOrbit: drag / arrows   Zoom: scroll   Pause: Space\n0 Reset view   R Reference frame"

func update_camera() -> void:
	camera.position = target+Vector3(sin(yaw)*cos(pitch),sin(pitch),cos(yaw)*cos(pitch))*radius
	camera.look_at(target)

func _unhandled_input(event: InputEvent) -> void:
	if not is_instance_valid(player): return
	if event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		yaw -= event.relative.x*.005
		pitch = clampf(pitch+event.relative.y*.005,-1.4,1.4)
		update_camera()
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP: radius *= .9
		if event.button_index == MOUSE_BUTTON_WHEEL_DOWN: radius *= 1.1
		update_camera()
	if event is InputEventKey and event.pressed:
		if event.keycode == KEY_SPACE and not event.echo: player.playing = not player.playing
		if event.keycode == KEY_LEFT: yaw -= PI/12.0
		if event.keycode == KEY_RIGHT: yaw += PI/12.0
		if event.keycode == KEY_0:
			yaw = reference_view.x
			pitch = reference_view.y
			radius = reference_view.z
		if event.keycode == KEY_R:
			player.playing = false
			player.seek(float(player.manifest.reference.time))
		if presentation and not event.echo:
			if event.keycode == KEY_1: open_bundle(bundle_directory.get_base_dir().path_join("fire-projectile/effect.avfx.json"))
			if event.keycode == KEY_2: open_bundle(bundle_directory.get_base_dir().path_join("shield/effect.avfx.json"))
		update_camera()
