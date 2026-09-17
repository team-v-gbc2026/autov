@tool
extends EditorInspectorPlugin

const Player = preload("player.gd")
const EffectPanel = preload("inspector_panel.gd")
var undo_redo: EditorUndoRedoManager

func _can_handle(object: Object) -> bool:
	return object is Player

func _parse_begin(object: Object) -> void:
	var panel := EffectPanel.new()
	panel.target = object
	panel.undo_redo = undo_redo
	add_custom_control(panel)

func _parse_property(_object: Object, _type: Variant.Type, name: String, _hint: PropertyHint, _hint_string: String, _usage: int, _wide: bool) -> bool:
	return name in ["script", "effect", "autoplay", "loop", "speed", "editor_preview", "preview_time", "editor_viewport"]
