@tool
extends VBoxContainer
## Editor-only UI; persisted edits participate in the scene's undo history.
const Asset = preload("asset.gd")
var target: Node3D
var undo_redo: EditorUndoRedoManager
var picker: EditorResourcePicker
var status: Label
var clock_label: Label
var scrub: HSlider
var play_button: Button
var toggles := {}
var speed_input: SpinBox
var viewport_input: SpinBox
var updating := false

func _ready() -> void:
	add_theme_constant_override("separation", 8)
	var heading := Label.new()
	heading.text = "AVFX EFFECT"
	heading.add_theme_font_size_override("font_size", 18)
	add_child(heading)
	var hint := Label.new()
	hint.text = "Drop an imported .avfx below. Preview here; play in any scene."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(hint)
	picker = EditorResourcePicker.new()
	picker.base_type = "Resource"
	picker.resource_changed.connect(_assign_effect)
	add_child(picker)
	status = Label.new()
	status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(status)
	var buttons := HBoxContainer.new()
	add_child(buttons)
	play_button = Button.new()
	play_button.text = "Preview"
	play_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	play_button.pressed.connect(_toggle_preview)
	buttons.add_child(play_button)
	var restart := Button.new()
	restart.text = "Restart"
	restart.pressed.connect(func(): _edit({"preview_time": 0.0, "editor_preview": true}, "Restart AVFX preview"); target.seek(0.0))
	buttons.add_child(restart)
	scrub = HSlider.new()
	scrub.step = 0.01
	scrub.value_changed.connect(func(value):
		if not updating: _edit({"preview_time": value, "editor_preview": false}, "Scrub AVFX preview", true))
	add_child(scrub)
	clock_label = Label.new()
	add_child(clock_label)
	for property in ["autoplay", "loop"]:
		var toggle := CheckBox.new()
		toggle.text = "Autoplay in game" if property == "autoplay" else "Loop in game"
		toggle.toggled.connect(func(value):
			if not updating: _edit({property: value}, "Change AVFX " + property))
		toggles[property] = toggle
		add_child(toggle)
	speed_input = _number("Playback speed", 0, 4, 0.05)
	speed_input.value_changed.connect(func(value):
		if not updating: _edit({"speed": value}, "Change AVFX speed", true))
	viewport_input = _number("Editor viewport", 0, 3, 1)
	viewport_input.value_changed.connect(func(value):
		if not updating: _edit({"editor_viewport": int(value)}, "Change AVFX preview camera"))
	var footer := Label.new()
	footer.text = "Preview loops independently of gameplay. Particle/surface adapter · experimental."
	footer.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(footer)
	_process(0.0)

func _number(title: String, minimum: float, maximum: float, step: float) -> SpinBox:
	var row := HBoxContainer.new()
	var label := Label.new()
	label.text = title
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(label)
	var input := SpinBox.new()
	input.min_value = minimum; input.max_value = maximum; input.step = step
	row.add_child(input)
	add_child(row)
	return input

func _edit(values: Dictionary, title: String, merge := false) -> void:
	if not is_instance_valid(target): return
	undo_redo.create_action(title, UndoRedo.MERGE_ENDS if merge else UndoRedo.MERGE_DISABLE, target)
	for property in values:
		undo_redo.add_do_property(target, property, values[property])
		undo_redo.add_undo_property(target, property, target.get(property))
	undo_redo.commit_action()

func _assign_effect(resource: Resource) -> void:
	if updating: return
	if resource != null and not resource is Asset:
		picker.edited_resource = target.effect
		EditorInterface.get_editor_toaster().push_toast("Choose an imported .avfx effect resource.")
		return
	_edit({"effect": resource}, "Assign AVFX effect")

func _toggle_preview() -> void:
	if target.editor_preview:
		_edit({"editor_preview": false, "preview_time": target.time}, "Pause AVFX preview")
	else:
		_edit({"editor_preview": true}, "Play AVFX preview")

func _process(_delta: float) -> void:
	if not is_instance_valid(target) or picker == null: return
	updating = true
	if picker.edited_resource != target.effect: picker.edited_resource = target.effect
	var duration := 0.0
	if target.effect is Asset:
		duration = float(target.effect.manifest.duration)
		status.text = "%s · %.2fs · %d layers" % [target.effect.manifest.get("name", "Effect"), duration, target.effect.layers.size()]
	else: status.text = "No effect assigned. Import a .avfx into the project first."
	if not target.last_error.is_empty(): status.text = target.last_error
	play_button.disabled = duration <= 0
	play_button.text = "Pause" if target.editor_preview else "Preview"
	scrub.max_value = maxf(duration, 0.01)
	scrub.editable = duration > 0
	if not scrub.has_focus(): scrub.set_value_no_signal(target.time)
	clock_label.text = "%.2f / %.2f s" % [target.time, duration]
	for property in toggles: toggles[property].set_pressed_no_signal(target.get(property))
	if not speed_input.get_line_edit().has_focus(): speed_input.set_value_no_signal(target.speed)
	viewport_input.set_value_no_signal(target.editor_viewport)
	updating = false
