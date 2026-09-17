@tool
extends EditorPlugin

const Importer = preload("importer.gd")
const Player = preload("player.gd")
const Inspector = preload("inspector.gd")
var _importer: EditorImportPlugin
var _inspector: EditorInspectorPlugin

func _enter_tree() -> void:
	_importer = Importer.new()
	add_import_plugin(_importer)
	# Read SVG directly: plugin startup can precede the initial asset import.
	var icon_image := Image.new()
	icon_image.load_svg_from_string(FileAccess.get_file_as_string(get_script().resource_path.get_base_dir().path_join("icon.svg")))
	add_custom_type("AVFXEffect", "Node3D", Player, ImageTexture.create_from_image(icon_image))
	_inspector = Inspector.new()
	_inspector.undo_redo = get_undo_redo()
	add_inspector_plugin(_inspector)

func _exit_tree() -> void:
	remove_custom_type("AVFXEffect")
	remove_inspector_plugin(_inspector)
	_inspector = null
	remove_import_plugin(_importer)
	_importer = null
