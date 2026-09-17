@tool
extends EditorImportPlugin

const Loader = preload("bundle_loader.gd")

func _get_importer_name() -> String: return "autov.avfx"
func _get_visible_name() -> String: return "AutoV AVFX effect"
func _get_recognized_extensions() -> PackedStringArray: return PackedStringArray(["avfx"])
func _get_save_extension() -> String: return "res"
func _get_resource_type() -> String: return "Resource"
func _get_preset_count() -> int: return 1
func _get_preset_name(_index: int) -> String: return "Particle + surface (experimental)"
func _get_import_options(_path: String, _preset: int) -> Array[Dictionary]: return []
func _get_import_order() -> int: return 0
func _get_priority() -> float: return 1.0
func _can_import_threaded() -> bool: return false

func _import(source_file: String, save_path: String, _options: Dictionary, _variants: Array[String], _generated: Array[String]) -> Error:
	var loader = Loader.new()
	var asset = loader.load_bundle(source_file)
	if asset == null:
		push_error("AVFX import failed: " + loader.error)
		return ERR_FILE_CORRUPT
	return ResourceSaver.save(asset, save_path + ".res", ResourceSaver.FLAG_COMPRESS)
